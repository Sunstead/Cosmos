use crate::{ AppState, NetSnapshot };
use cosmos_common::types::{ DiskInfo, HostInfo };
use sysinfo::{ Disks, Networks, System };

pub async fn get_host_info(state: AppState) -> HostInfo {
    let mut sys = System::new();
    sys.refresh_cpu_usage();
    tokio::time::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL).await;
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let cpu_pct = sys.global_cpu_info().cpu_usage();
    let mem_used_gb = (sys.used_memory() as f64) / 1_073_741_824.0;
    let mem_total_gb = (sys.total_memory() as f64) / 1_073_741_824.0;
    let uptime_secs = System::uptime();
    let hostname = System::host_name().unwrap_or_else(|| "unknown".to_string());

    let disks = Disks::new_with_refreshed_list();
    let disk: Vec<DiskInfo> = disks
        .iter()
        .filter(|d| d.total_space() > 0)
        .map(|d| DiskInfo {
            mount: d.mount_point().to_string_lossy().to_string(),
            used_gb: ((d.total_space() - d.available_space()) as f64) / 1_073_741_824.0,
            total_gb: (d.total_space() as f64) / 1_073_741_824.0,
        })
        .collect();

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
        cpu_pct,
        mem_used_gb,
        mem_total_gb,
        disk,
        net_rx_mbps,
        net_tx_mbps,
        uptime_secs,
    }
}
