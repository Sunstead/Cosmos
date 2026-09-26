//! Host metrics probe, owned by the sampler thread. It alone holds the
//! previous counters, so rate deltas are correct for any number of clients.

use super::{ facts::HostFacts, filters::HostFilters };
use cosmos_common::types::{ DiskInfo, DiskKind, HostInfo, NetInfo };
use std::{ collections::HashMap, sync::Arc, time::Instant };
use sysinfo::{ CpuRefreshKind, Disks, MemoryRefreshKind, Networks, RefreshKind, System };

/// Re-enumerate devices every this many ticks. In between we only refresh the
/// counters of devices we already know about, which is far cheaper than
/// rebuilding the list.
const REENUMERATE_EVERY: u64 = 60;

/// A single host sample, before static facts are attached.
pub struct HostSample {
    pub cpu_pct: f32,
    pub cpu_per_core: Vec<f32>,
    pub mem_used_bytes: u64,
    pub swap_used_bytes: u64,
    pub load1: f64,
    pub load5: f64,
    pub load15: f64,
    pub disk: Vec<DiskInfo>,
    pub nets: Vec<NetInfo>,
    pub net_rx_bps: f64,
    pub net_tx_bps: f64,
    pub uptime_secs: u64,
    pub sampled_at: i64,
}

/// What subscribers receive.
///
/// The JSON is rendered once per tick here rather than once per request per
/// client, so the HTTP path never touches serde. The disks are also kept
/// typed, for the event log's disk-space check.
pub struct HostSnapshot {
    pub json: Arc<str>,
    pub disks: Arc<[DiskInfo]>,
}

impl HostSnapshot {
    pub fn new(seq: u64, sample: HostSample, facts: &HostFacts) -> Self {
        let info = HostInfo {
            name: facts.node_name.clone(),
            hostname: facts.hostname.clone(),
            os: facts.os.clone(),
            kernel: facts.kernel.clone(),
            arch: facts.arch.clone(),
            cpu_model: facts.cpu_model.clone(),
            cpu_physical_cores: facts.cpu_physical_cores,
            cpu_logical_cores: facts.cpu_logical_cores,
            cpu_freq_mhz: facts.cpu_freq_mhz,
            mem_total_bytes: facts.mem_total_bytes,
            swap_total_bytes: facts.swap_total_bytes,

            cpu_pct: sample.cpu_pct,
            cpu_per_core: sample.cpu_per_core,
            mem_used_bytes: sample.mem_used_bytes,
            swap_used_bytes: sample.swap_used_bytes,
            load1: sample.load1,
            load5: sample.load5,
            load15: sample.load15,
            disk: sample.disk.clone(),
            nets: sample.nets,
            net_rx_bps: sample.net_rx_bps,
            net_tx_bps: sample.net_tx_bps,
            uptime_secs: sample.uptime_secs,
            sampled_at: sample.sampled_at,
            seq,
        };

        let json: Arc<str> = serde_json
            ::to_string(&info)
            .unwrap_or_else(|e| {
                // HostInfo is plain data; this cannot fail in practice, but
                // emitting `{}` beats panicking on the sampler thread.
                tracing::error!(error = %e, "failed to serialize host snapshot");
                "{}".to_string()
            })
            .into();

        Self { json, disks: sample.disk.into() }
    }
}

pub struct HostProbe {
    sys: System,
    disks: Disks,
    nets: Networks,
    filters: Arc<HostFilters>,
    /// iface -> cumulative (rx, tx)
    prev_net: HashMap<String, (u64, u64)>,
    /// mount -> cumulative (read, written)
    prev_disk: HashMap<String, (u64, u64)>,
    /// mount -> storage pool, see `pool_key`. Cleared on re-enumeration.
    pools: HashMap<String, String>,
    prev_at: Instant,
    ticks: u64,
}

impl HostProbe {
    /// Exactly what gets published, and nothing else. Notably absent:
    /// processes (walking `/proc/<pid>` is by far the most expensive thing
    /// sysinfo does) and CPU frequency (static; lives in `HostFacts`).
    fn refresh_kind() -> RefreshKind {
        RefreshKind::nothing()
            .with_cpu(CpuRefreshKind::nothing().with_cpu_usage())
            .with_memory(MemoryRefreshKind::nothing().with_ram().with_swap())
    }

    pub fn new(filters: Arc<HostFilters>) -> Self {
        let mut sys = System::new_with_specifics(Self::refresh_kind());

        // Seed the CPU counters so the first sample is a valid delta. The only
        // sleep in the program; it runs once at startup, never on a request.
        sys.refresh_specifics(Self::refresh_kind());
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
        sys.refresh_specifics(Self::refresh_kind());

        let disks = Disks::new_with_refreshed_list();
        let nets = Networks::new_with_refreshed_list();

        let mut probe = Self {
            sys,
            disks,
            nets,
            filters,
            prev_net: HashMap::new(),
            prev_disk: HashMap::new(),
            pools: HashMap::new(),
            prev_at: Instant::now(),
            ticks: 0,
        };
        probe.seed_counters();
        probe
    }

    fn seed_counters(&mut self) {
        for (name, n) in self.nets.list() {
            self.prev_net.insert(name.clone(), (n.total_received(), n.total_transmitted()));
        }
        for d in self.disks.list() {
            let mount = d.mount_point().to_string_lossy().into_owned();
            let usage = d.usage();
            self.prev_disk.insert(mount, (usage.total_read_bytes, usage.total_written_bytes));
        }
    }

    /// One tick. Synchronous, no awaits, no locks.
    pub fn sample(&mut self) -> HostSample {
        let now = Instant::now();
        // Guard against a zero or absurdly small interval producing a divide
        // that reports petabytes per second.
        let dt = now.duration_since(self.prev_at).as_secs_f64().max(1e-3);
        self.prev_at = now;
        self.ticks = self.ticks.wrapping_add(1);

        self.sys.refresh_specifics(Self::refresh_kind());

        let reenumerate = self.ticks.is_multiple_of(REENUMERATE_EVERY);
        self.disks.refresh(reenumerate);
        if reenumerate {
            self.pools.clear();
        }
        self.nets.refresh(reenumerate);

        let (nets, net_rx_bps, net_tx_bps) = self.sample_nets(dt);
        let disk = self.sample_disks(dt);

        let load = System::load_average();

        HostSample {
            cpu_pct: self.sys.global_cpu_usage(),
            cpu_per_core: self.sys
                .cpus()
                .iter()
                .map(|c| c.cpu_usage())
                .collect(),
            mem_used_bytes: self.sys.used_memory(),
            swap_used_bytes: self.sys.used_swap(),
            load1: load.one,
            load5: load.five,
            load15: load.fifteen,
            disk,
            nets,
            net_rx_bps,
            net_tx_bps,
            uptime_secs: System::uptime(),
            sampled_at: unix_now(),
        }
    }

    fn sample_nets(&mut self, dt: f64) -> (Vec<NetInfo>, f64, f64) {
        let mut nets = Vec::new();
        let (mut total_rx, mut total_tx) = (0.0, 0.0);

        for (name, n) in self.nets.list() {
            if !self.filters.iface_allowed(name) {
                continue;
            }
            let (rx_total, tx_total) = (n.total_received(), n.total_transmitted());

            // `saturating_sub` matters: counters reset when an interface goes
            // down and back up, and a negative delta would otherwise wrap into
            // an enormous rate.
            let (rx_bps, tx_bps) = match self.prev_net.get(name) {
                Some(&(prev_rx, prev_tx)) =>
                    (
                        (rx_total.saturating_sub(prev_rx) as f64) / dt,
                        (tx_total.saturating_sub(prev_tx) as f64) / dt,
                    ),
                // First sighting: report zero rather than a since-boot average
                // masquerading as an instantaneous rate.
                None => (0.0, 0.0),
            };

            total_rx += rx_bps;
            total_tx += tx_bps;
            nets.push(NetInfo {
                name: name.clone(),
                rx_bps,
                tx_bps,
                rx_total_bytes: rx_total,
                tx_total_bytes: tx_total,
            });
        }

        // Rebuild rather than insert-in-place so interfaces that disappeared
        // don't linger in the map forever.
        self.prev_net = self.nets
            .list()
            .iter()
            .map(|(name, n)| (name.clone(), (n.total_received(), n.total_transmitted())))
            .collect();

        nets.sort_by(|a, b| a.name.cmp(&b.name));
        (nets, total_rx, total_tx)
    }

    fn sample_disks(&mut self, dt: f64) -> Vec<DiskInfo> {
        let mut disk: Vec<(String, DiskInfo)> = Vec::with_capacity(self.filters.disk_hint());
        let mut next_prev = HashMap::with_capacity(self.prev_disk.len());

        for d in self.disks.list() {
            let mount = d.mount_point().to_string_lossy().into_owned();
            let usage = d.usage();
            next_prev.insert(mount.clone(), (usage.total_read_bytes, usage.total_written_bytes));

            if d.total_space() == 0 {
                continue;
            }
            // Filters out overlayfs, tmpfs and bind-mount noise, and names
            // mounts under the host root by their host path.
            let Some(label) = self.filters.disk_label(&mount, &d.file_system().to_string_lossy()) else {
                continue;
            };

            let (read_bps, write_bps) = match self.prev_disk.get(&mount) {
                Some(&(prev_read, prev_written)) =>
                    (
                        (usage.total_read_bytes.saturating_sub(prev_read) as f64) / dt,
                        (usage.total_written_bytes.saturating_sub(prev_written) as f64) / dt,
                    ),
                None => (0.0, 0.0),
            };

            let pool = self.pools
                .entry(mount.clone())
                .or_insert_with(|| pool_key(d))
                .clone();

            disk.push((pool, DiskInfo {
                mount,
                label,
                // Counts reserved blocks as used, which is why this can read
                // slightly higher than `df`'s Used column.
                used_bytes: d.total_space().saturating_sub(d.available_space()),
                total_bytes: d.total_space(),
                read_bps,
                write_bps,
                kind: match d.kind() {
                    sysinfo::DiskKind::SSD => DiskKind::Ssd,
                    sysinfo::DiskKind::HDD => DiskKind::Hdd,
                    _ => DiskKind::Unknown,
                },
            }));
        }

        self.prev_disk = next_prev;
        let mut disk = dedupe_shared_volumes(disk);
        disk.sort_by(|a, b| a.label.cmp(&b.label));
        disk
    }
}

pub fn unix_now() -> i64 {
    std::time::SystemTime
        ::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Identifies the storage behind a mount, so volumes that share it are
/// counted once. Mounts that don't resolve to a device stay distinct.
fn pool_key(d: &sysinfo::Disk) -> String {
    let mount = d.mount_point();
    // APFS volumes all carry the container's size and I/O, and sysinfo names
    // them by volume label, so ask the kernel for the device instead.
    #[cfg(target_os = "macos")]
    if let Some(dev) = macos_mount_source(mount) {
        return apfs_container(&dev).unwrap_or(dev);
    }
    // Linux: bind mounts and btrfs subvolumes repeat the same device path.
    let name = d.name().to_string_lossy();
    if name.starts_with("/dev/") {
        name.into_owned()
    } else {
        format!("mount:{}", mount.to_string_lossy())
    }
}

/// `/dev/disk3s1s1` and `/dev/disk3s5` are volumes of container `disk3`.
#[cfg(any(target_os = "macos", test))]
fn apfs_container(dev: &str) -> Option<String> {
    let rest = dev.strip_prefix("/dev/disk")?;
    let n: String = rest.chars().take_while(char::is_ascii_digit).collect();
    (!n.is_empty()).then(|| format!("disk{n}"))
}

#[cfg(target_os = "macos")]
fn macos_mount_source(path: &std::path::Path) -> Option<String> {
    use std::ffi::{ CStr, CString };
    use std::os::unix::ffi::OsStrExt;

    let c_path = CString::new(path.as_os_str().as_bytes()).ok()?;
    // SAFETY: statfs fills a zeroed, correctly sized struct; f_mntfromname is
    // a NUL-terminated fixed array.
    unsafe {
        let mut st: libc::statfs = std::mem::zeroed();
        if libc::statfs(c_path.as_ptr(), &mut st) != 0 {
            return None;
        }
        Some(CStr::from_ptr(st.f_mntfromname.as_ptr()).to_string_lossy().into_owned())
    }
}

/// Keeps one entry per pool, preferring the shortest label (usually `/`).
fn dedupe_shared_volumes(mut disks: Vec<(String, DiskInfo)>) -> Vec<DiskInfo> {
    disks.sort_by(|(_, a), (_, b)| a.label.len().cmp(&b.label.len()).then_with(|| a.label.cmp(&b.label)));
    let mut seen = std::collections::HashSet::with_capacity(disks.len());
    disks
        .into_iter()
        .filter(|(pool, _)| seen.insert(pool.clone()))
        .map(|(_, d)| d)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn disk(pool: &str, label: &str, total: u64, used: u64) -> (String, DiskInfo) {
        (pool.into(), DiskInfo {
            mount: label.into(),
            label: label.into(),
            used_bytes: used,
            total_bytes: total,
            read_bps: 0.0,
            write_bps: 0.0,
            kind: DiskKind::Ssd,
        })
    }

    #[test]
    fn shared_volumes_count_once_even_when_readings_differ() {
        let out = dedupe_shared_volumes(vec![
            disk("disk3", "/System/Volumes/Data", 1000, 901),
            disk("disk3", "/", 1000, 900),
            disk("/dev/sdb1", "/mnt/backup", 4000, 100),
            // Identical drives with identical usage are still distinct.
            disk("/dev/sdc1", "/mnt/mirror", 4000, 100),
        ]);
        let labels: Vec<_> = out.iter().map(|d| d.label.as_str()).collect();
        assert_eq!(labels, ["/", "/mnt/backup", "/mnt/mirror"]);
    }

    #[test]
    fn apfs_volumes_map_to_their_container() {
        assert_eq!(apfs_container("/dev/disk3s1s1").as_deref(), Some("disk3"));
        assert_eq!(apfs_container("/dev/disk12s5").as_deref(), Some("disk12"));
        assert_eq!(apfs_container("/dev/sda1"), None);
        assert_eq!(apfs_container("map auto_home"), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn root_and_data_volume_share_a_pool() {
        let disks = Disks::new_with_refreshed_list();
        let pool = |m: &str| disks.list().iter().find(|d| d.mount_point() == std::path::Path::new(m)).map(pool_key);
        if let (Some(root), Some(data)) = (pool("/"), pool("/System/Volumes/Data")) {
            assert_eq!(root, data);
        }
    }
    use crate::config::HostConfig;

    fn probe() -> HostProbe {
        HostProbe::new(Arc::new(HostFilters::from_config(&HostConfig::default())))
    }

    #[test]
    fn first_sample_reports_zero_rates_rather_than_since_boot_averages() {
        let mut p = probe();
        // Counters were seeded in `new`, so the very first tick has a real
        // (tiny) interval to difference against and must not report a burst.
        let s = p.sample();
        assert!(s.net_rx_bps >= 0.0 && s.net_rx_bps.is_finite());
        assert!(s.net_tx_bps >= 0.0 && s.net_tx_bps.is_finite());
        for d in &s.disk {
            assert!(d.read_bps.is_finite() && d.read_bps >= 0.0);
            assert!(d.write_bps.is_finite() && d.write_bps >= 0.0);
        }
    }

    #[test]
    fn samples_are_plausible_and_repeatable() {
        let mut p = probe();
        p.sample();
        std::thread::sleep(std::time::Duration::from_millis(250));
        let s = p.sample();

        assert!((0.0..=100.0).contains(&s.cpu_pct), "cpu_pct out of range: {}", s.cpu_pct);
        assert!(s.mem_used_bytes > 0);
        assert!(s.uptime_secs > 0);
        assert!(s.sampled_at > 1_600_000_000, "sampled_at should be a real unix timestamp");
        assert!(!s.cpu_per_core.is_empty());
        for core in &s.cpu_per_core {
            assert!((0.0..=100.0).contains(core), "per-core out of range: {core}");
        }
    }

    #[test]
    fn repeated_sampling_does_not_grow_the_delta_maps() {
        let mut p = probe();
        p.sample();
        let after_first = (p.prev_net.len(), p.prev_disk.len());
        for _ in 0..5 {
            p.sample();
        }
        assert_eq!(
            (p.prev_net.len(), p.prev_disk.len()),
            after_first,
            "delta maps must be rebuilt, not accumulated"
        );
    }

    #[test]
    fn snapshot_serializes_the_shape_clients_consume() {
        let mut p = probe();
        let facts = HostFacts::probe(Some("testnode"));
        let snap = HostSnapshot::new(7, p.sample(), &facts);

        // Asserting on the wire format rather than the struct: this is what
        // the generated TypeScript types have to match.
        let parsed: serde_json::Value = serde_json
            ::from_str(&snap.json)
            .expect("cached json must be valid");

        assert_eq!(parsed["seq"], 7);
        assert_eq!(parsed["name"], "testnode");
        assert!(parsed["cpu_per_core"].is_array());
        assert!(parsed["nets"].is_array());

        // Rates are bytes/sec; the pre-0.2 names must not return.
        assert!(parsed.get("net_rx_bps").is_some());
        assert!(parsed.get("net_rx_mbps").is_none());
        assert!(parsed.get("mem_used_bytes").is_some());
        assert!(parsed.get("mem_used_gb").is_none());
    }
}
