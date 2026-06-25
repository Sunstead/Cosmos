use crate::{ AppState, NetSnapshot };
use cosmos_common::types::{ DiskInfo, HostInfo };
use sysinfo::{ Disks, DiskKind, Networks, System };
use std::collections::HashMap;

pub async fn get_host_info(state: AppState) -> HostInfo {
    let mut sys = System::new();
    sys.refresh_cpu_usage();
    tokio::time::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL).await;
    sys.refresh_cpu_all();
    sys.refresh_memory();

    let cpu_pct = sys.global_cpu_usage();

    let first_cpu = sys.cpus().first();
    let cpu_model = first_cpu
        .map(|c| c.brand().to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let cpu_freq_mhz = first_cpu.map(|c| c.frequency()).unwrap_or(0);
    let cpu_logical_cores = sys.cpus().len();
    let cpu_physical_cores = sysinfo::System::physical_core_count().unwrap_or(0);

    let mem_used_gb = (sys.used_memory() as f64) / 1_073_741_824.0;
    let mem_total_gb = (sys.total_memory() as f64) / 1_073_741_824.0;
    let uptime_secs = System::uptime();
    let hostname = System::host_name().unwrap_or_else(|| "unknown".to_string());
    let os = System::long_os_version().unwrap_or_default();

    let disks = Disks::new_with_refreshed_list();

    let disk: Vec<DiskInfo> = {
        let mut last = state.last_disk.lock().await;
        let now = std::time::Instant::now();

        let result = disks
            .iter()
            .filter(|d| d.total_space() > 0)
            .map(|d| {
                let mount = d.mount_point().to_string_lossy().to_string();
                let usage = d.usage();

                let (read_mbps, write_mbps) = match last.as_ref() {
                    Some(prev) => {
                        let elapsed = now.duration_since(prev.time).as_secs_f64();
                        if elapsed > 0.0 {
                            let prev_read = prev.read_bytes.get(&mount).copied().unwrap_or(0);
                            let prev_write = prev.write_bytes.get(&mount).copied().unwrap_or(0);
                            let read =
                                (usage.read_bytes.saturating_sub(prev_read) as f64) /
                                elapsed /
                                1_048_576.0;
                            let write =
                                (usage.written_bytes.saturating_sub(prev_write) as f64) /
                                elapsed /
                                1_048_576.0;
                            (read, write)
                        } else {
                            (0.0, 0.0)
                        }
                    }
                    None => (0.0, 0.0),
                };

                let kind = match d.kind() {
                    DiskKind::SSD => "SSD".to_string(),
                    DiskKind::HDD => "HDD".to_string(),
                    _ => "Unknown".to_string(),
                };

                DiskInfo {
                    mount: mount.clone(),
                    used_gb: ((d.total_space() - d.available_space()) as f64) / 1_073_741_824.0,
                    total_gb: (d.total_space() as f64) / 1_073_741_824.0,
                    read_mbps,
                    write_mbps,
                    kind,
                }
            })
            .collect();

        let mut read_bytes = HashMap::new();
        let mut write_bytes = HashMap::new();
        for d in disks.iter() {
            let mount = d.mount_point().to_string_lossy().to_string();
            let usage = d.usage();
            read_bytes.insert(mount.clone(), usage.read_bytes);
            write_bytes.insert(mount, usage.written_bytes);
        }
        *last = Some(crate::DiskSnapshot { read_bytes, write_bytes, time: now });

        result
    };

    let networks = Networks::new_with_refreshed_list();
    let (rx_bytes, tx_bytes): (u64, u64) = networks
        .iter()
        .fold((0u64, 0u64), |(rx, tx), (_, n)| {
            (rx + n.total_received(), tx + n.total_transmitted())
        });

    let (net_rx_mbps, net_tx_mbps) = {
        let mut last = state.last_net.lock().await;
        let now = std::time::Instant::now();

        let mbps = match last.as_ref() {
            Some(prev) => {
                let elapsed = now.duration_since(prev.time).as_secs_f64();
                if elapsed > 0.0 {
                    let rx =
                        ((rx_bytes.saturating_sub(prev.rx_bytes) as f64) * 8.0) /
                        (elapsed * 1_000_000.0);
                    let tx =
                        ((tx_bytes.saturating_sub(prev.tx_bytes) as f64) * 8.0) /
                        (elapsed * 1_000_000.0);
                    (rx, tx)
                } else {
                    (0.0, 0.0)
                }
            }
            None => (0.0, 0.0),
        };

        *last = Some(NetSnapshot { rx_bytes, tx_bytes, time: now });
        mbps
    };

    HostInfo {
        name: state.node_name,
        hostname,
        os,
        cpu_pct,
        cpu_model,
        cpu_physical_cores,
        cpu_logical_cores,
        cpu_freq_mhz,
        mem_used_gb,
        mem_total_gb,
        disk,
        net_rx_mbps,
        net_tx_mbps,
        uptime_secs,
    }
}
