//! Which network interfaces and filesystems get reported.
//!
//! This matters more than it looks. Under `network_mode: host` the agent sees
//! every bridge, veth and tunnel the host has, and summing those into "node
//! throughput" counts container traffic two or three times over. Likewise, a
//! containerised agent's `/proc/mounts` is full of overlayfs and bind mounts
//! nobody wants to see charted.

use crate::config::HostConfig;
use std::collections::HashMap;

pub struct HostFilters {
    net_include: Vec<Pattern>,
    net_exclude: Vec<Pattern>,
    /// Mount point as seen by the agent -> label to show the user.
    /// Empty (and no `root`) means "report every real filesystem".
    disk_labels: HashMap<String, String>,
    /// Where the host's `/` appears to the agent, e.g. `/host/rootfs`.
    root: Option<String>,
}

impl HostFilters {
    pub fn from_config(cfg: &HostConfig) -> Self {
        Self {
            net_include: cfg.net_include.iter().map(|p| Pattern::new(p)).collect(),
            net_exclude: cfg.net_exclude.iter().map(|p| Pattern::new(p)).collect(),
            disk_labels: cfg.disks
                .iter()
                .map(|d| (d.path.clone(), d.label.clone().unwrap_or_else(|| d.path.clone())))
                .collect(),
            // Every deployment that mounts the host root already names it
            // `/`, so existing configs discover their other drives unchanged.
            root: cfg.root
                .clone()
                .or_else(|| {
                    cfg.disks
                        .iter()
                        .find(|d| d.label.as_deref() == Some("/"))
                        .map(|d| d.path.clone())
                })
                .map(|r| r.trim_end_matches('/').to_string()),
        }
    }

    /// A non-empty include list is an allowlist and wins outright; otherwise
    /// everything is allowed except what the exclude list matches.
    pub fn iface_allowed(&self, name: &str) -> bool {
        if !self.net_include.is_empty() {
            return self.net_include.iter().any(|p| p.matches(name));
        }
        !self.net_exclude.iter().any(|p| p.matches(name))
    }

    /// `Some(label)` if this mount should be reported, in this order:
    ///
    /// 1. A `[[host.disks]]` entry: reported under its label, whatever it is.
    /// 2. Under the host root: `/host/rootfs/srv` is the host's `/srv`. The
    ///    root bind is recursive, so every drive the host has mounted is
    ///    already visible; listing only the root used to hide them all.
    /// 3. No configuration at all (running directly on a host): every mount
    ///    under its own name.
    ///
    /// 2 and 3 skip what nobody charts: virtual and memory-backed
    /// filesystems, container storage and boot partitions.
    pub fn disk_label(&self, mount: &str, fs: &str) -> Option<String> {
        if let Some(label) = self.disk_labels.get(mount) {
            return Some(label.clone());
        }
        let host_path = match &self.root {
            // The root itself is always reported, whatever backs it (some
            // appliance and VM images run from an overlay).
            Some(root) if mount == root => {
                return Some("/".to_string());
            }
            Some(root) => format!("/{}", mount.strip_prefix(root.as_str())?.strip_prefix('/')?),
            None if self.disk_labels.is_empty() => mount.to_string(),
            None => {
                return None;
            }
        };
        reportable(&host_path, fs).then_some(host_path)
    }

    /// Hint for `Vec::with_capacity`.
    pub fn disk_hint(&self) -> usize {
        self.disk_labels.len().max(4)
    }
}

/// Filesystems that aren't storage: memory, kernel interfaces, image layers.
const VIRTUAL_FS: &[&str] = &[
    "overlay",
    "aufs",
    "squashfs",
    "tmpfs",
    "ramfs",
    "devtmpfs",
    "devfs",
    "nsfs",
    "autofs",
    "tracefs",
    "efivarfs",
    "fuse.lxcfs",
];

/// Host paths whose mounts are plumbing: boot partitions, container runtimes'
/// storage, and the kernel's own trees.
const SKIPPED_PATHS: &[&str] = &[
    "/boot",
    "/efi",
    "/var/lib/docker",
    "/var/lib/containers",
    "/var/lib/containerd",
    "/var/lib/kubelet",
    "/var/lib/lxcfs",
    "/snap",
    "/run",
    "/dev",
    "/sys",
    "/proc",
];

fn reportable(host_path: &str, fs: &str) -> bool {
    let under = |p: &&str| {
        host_path == *p ||
            host_path.strip_prefix(*p).is_some_and(|rest| rest.starts_with('/'))
    };
    !VIRTUAL_FS.contains(&fs) && !SKIPPED_PATHS.iter().any(under)
}

/// A glob supporting a single `*` wildcard, which covers every pattern anyone
/// writes for an interface name (`docker*`, `br-*`, `veth*`). Not worth a
/// regex or a glob crate.
struct Pattern {
    prefix: String,
    suffix: Option<String>,
}

impl Pattern {
    fn new(raw: &str) -> Self {
        match raw.split_once('*') {
            Some((prefix, suffix)) =>
                Self { prefix: prefix.to_string(), suffix: Some(suffix.to_string()) },
            None => Self { prefix: raw.to_string(), suffix: None },
        }
    }

    fn matches(&self, name: &str) -> bool {
        match &self.suffix {
            None => name == self.prefix,
            Some(suffix) =>
                name.len() >= self.prefix.len() + suffix.len() &&
                name.starts_with(&self.prefix) &&
                name.ends_with(suffix.as_str()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::DiskConfig;

    fn cfg(include: &[&str], exclude: &[&str]) -> HostConfig {
        HostConfig {
            net_include: include.iter().map(|s| s.to_string()).collect(),
            net_exclude: exclude.iter().map(|s| s.to_string()).collect(),
            ..Default::default()
        }
    }

    #[test]
    fn default_exclusions_drop_the_interfaces_that_double_count_traffic() {
        let f = HostFilters::from_config(&HostConfig::default());
        // `lo0` is macOS's loopback; a live run showed it leaking into the
        // totals when the pattern was the exact string "lo".
        for noisy in ["lo", "lo0", "docker0", "br-1a2b3c", "veth9f8e7d", "virbr0"] {
            assert!(!f.iface_allowed(noisy), "{noisy} should be excluded by default");
        }
        for real in ["eth0", "enp3s0", "wlan0", "bond0"] {
            assert!(f.iface_allowed(real), "{real} should be reported");
        }
    }

    #[test]
    fn include_list_wins_over_exclude() {
        let f = HostFilters::from_config(&cfg(&["eth0"], &["eth*"]));
        assert!(f.iface_allowed("eth0"));
        assert!(!f.iface_allowed("eth1"), "not on the allowlist");
    }

    #[test]
    fn wildcard_matches_prefix_and_suffix() {
        let f = HostFilters::from_config(&cfg(&[], &["br-*", "*.tmp"]));
        assert!(!f.iface_allowed("br-abc"));
        assert!(!f.iface_allowed("foo.tmp"));
        assert!(f.iface_allowed("br"), "the wildcard requires at least an empty remainder match");
        assert!(f.iface_allowed("abr-c"));
    }

    #[test]
    fn unconfigured_disks_pass_through_under_their_own_name() {
        let f = HostFilters::from_config(&HostConfig::default());
        assert_eq!(f.disk_label("/", "apfs"), Some("/".to_string()));
    }

    #[test]
    fn configured_disks_are_an_allowlist_and_get_remapped() {
        let host = HostConfig {
            disks: vec![
                DiskConfig { path: "/host/rootfs".into(), label: Some("/".into()) },
                DiskConfig { path: "/host/mnt/tank".into(), label: None }
            ],
            ..Default::default()
        };
        let f = HostFilters::from_config(&host);

        assert_eq!(f.disk_label("/host/rootfs", "ext4"), Some("/".to_string()));
        // No label configured: fall back to the path itself.
        assert_eq!(f.disk_label("/host/mnt/tank", "zfs"), Some("/host/mnt/tank".to_string()));
        // Container noise stays out.
        assert_eq!(f.disk_label("/var/lib/docker/overlay2/abc", "overlay"), None);
        assert_eq!(f.disk_label("/etc/resolv.conf", "ext4"), None);
    }

    fn rootfs(extra: Vec<DiskConfig>) -> HostFilters {
        let mut disks = vec![DiskConfig { path: "/host/rootfs".into(), label: Some("/".into()) }];
        disks.extend(extra);
        HostFilters::from_config(&HostConfig { disks, ..Default::default() })
    }

    /// The reported bug: the example config names only `/host/rootfs`, so a
    /// second drive the recursive bind already exposed (a 2TB disk at /srv)
    /// was filtered out and only the root partition showed.
    #[test]
    fn drives_under_the_host_root_are_reported_under_their_host_path() {
        let f = rootfs(vec![]);
        assert_eq!(f.disk_label("/host/rootfs", "ext4"), Some("/".into()));
        assert_eq!(f.disk_label("/host/rootfs/srv", "ext4"), Some("/srv".into()));
        assert_eq!(f.disk_label("/host/rootfs/mnt/tank", "zfs"), Some("/mnt/tank".into()));
        assert_eq!(f.disk_label("/host/rootfs/home", "btrfs"), Some("/home".into()));
        assert_eq!(f.disk_label("/host/rootfs/mnt/nas", "nfs4"), Some("/mnt/nas".into()));
    }

    #[test]
    fn the_host_root_is_found_from_the_entry_labelled_slash() {
        // Nothing new to configure: existing deployments pick this up.
        let f = rootfs(vec![]);
        assert_eq!(f.disk_label("/host/rootfs/data", "xfs"), Some("/data".into()));
        // Without a "/" entry nothing is discovered.
        let f = HostFilters::from_config(&HostConfig {
            disks: vec![DiskConfig { path: "/host/mnt/tank".into(), label: None }],
            ..Default::default()
        });
        assert_eq!(f.disk_label("/host/mnt/tank/sub", "zfs"), None);
    }

    #[test]
    fn a_configured_root_needs_no_slash_entry() {
        let f = HostFilters::from_config(&HostConfig { root: Some("/hostfs".into()), ..Default::default() });
        assert_eq!(f.disk_label("/hostfs", "ext4"), Some("/".into()));
        assert_eq!(f.disk_label("/hostfs/srv", "ext4"), Some("/srv".into()));
        assert_eq!(f.disk_label("/hostfsx/srv", "ext4"), None, "a prefix of the name is not a parent");
        // A host running from an overlay still has a root to report.
        assert_eq!(f.disk_label("/hostfs", "overlay"), Some("/".into()));
    }

    #[test]
    fn host_mounts_nobody_charts_stay_out() {
        let f = rootfs(vec![]);
        for (mount, fs) in [
            // Docker's own storage, via the recursive bind.
            ("/host/rootfs/var/lib/docker/overlay2/abc/merged", "overlay"),
            ("/host/rootfs/var/lib/docker", "ext4"),
            ("/host/rootfs/var/lib/containers/storage", "xfs"),
            ("/host/rootfs/var/lib/kubelet/pods/x", "ext4"),
            // Boot partitions: real, tiny, never interesting.
            ("/host/rootfs/boot", "ext4"),
            ("/host/rootfs/boot/efi", "vfat"),
            ("/host/rootfs/efi", "vfat"),
            // Memory-backed and virtual.
            ("/host/rootfs/dev/shm", "tmpfs"),
            ("/host/rootfs/run/user/1000", "tmpfs"),
            ("/host/rootfs/snap/core/1", "squashfs"),
            ("/host/rootfs/var/lib/lxcfs", "fuse.lxcfs"),
            // The container's own files, outside the host root.
            ("/etc/hosts", "ext4"),
        ] {
            assert_eq!(f.disk_label(mount, fs), None, "{mount} ({fs}) should not be reported");
        }
    }

    #[test]
    fn an_explicit_entry_still_names_a_discovered_drive() {
        let f = rootfs(vec![DiskConfig { path: "/host/rootfs/srv".into(), label: Some("storage".into()) }]);
        assert_eq!(f.disk_label("/host/rootfs/srv", "ext4"), Some("storage".into()));
    }

    #[test]
    fn on_a_bare_host_boot_and_docker_mounts_are_skipped_too() {
        let f = HostFilters::from_config(&HostConfig::default());
        assert_eq!(f.disk_label("/srv", "ext4"), Some("/srv".into()));
        assert_eq!(f.disk_label("/boot/efi", "vfat"), None);
        assert_eq!(f.disk_label("/var/lib/docker/overlay2/x/merged", "overlay"), None);
    }
}
