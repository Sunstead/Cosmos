//! Machine facts that don't change while it runs, computed once at startup.

use sysinfo::{ CpuRefreshKind, RefreshKind, System };

#[derive(Debug, Clone)]
pub struct HostFacts {
    pub node_name: String,
    pub hostname: String,
    pub os: String,
    pub kernel: String,
    pub arch: String,
    pub cpu_model: String,
    pub cpu_physical_cores: u32,
    pub cpu_logical_cores: u32,
    pub cpu_freq_mhz: u64,
    pub mem_total_bytes: u64,
    pub swap_total_bytes: u64,
}

impl HostFacts {
    pub fn probe(configured_name: Option<&str>) -> Self {
        // The only place frequency is ever read. It's the expensive half of
        // `refresh_cpu_all()`, and it never meaningfully changes.
        let mut sys = System::new_with_specifics(
            RefreshKind::nothing()
                .with_cpu(CpuRefreshKind::nothing().with_frequency())
                .with_memory(sysinfo::MemoryRefreshKind::nothing().with_ram().with_swap())
        );
        sys.refresh_specifics(
            RefreshKind::nothing().with_cpu(CpuRefreshKind::nothing().with_frequency())
        );

        let hostname = System::host_name().unwrap_or_else(|| "unknown".to_string());
        let first_cpu = sys.cpus().first();

        Self {
            node_name: configured_name
                .map(str::to_string)
                .unwrap_or_else(|| hostname.clone()),
            hostname,
            os: System::long_os_version().unwrap_or_else(|| "unknown".to_string()),
            kernel: System::kernel_version().unwrap_or_else(|| "unknown".to_string()),
            arch: System::cpu_arch(),
            cpu_model: first_cpu
                .map(|c| c.brand().trim().to_string())
                .filter(|b| !b.is_empty())
                .unwrap_or_else(|| "unknown".to_string()),
            cpu_physical_cores: System::physical_core_count().unwrap_or(0) as u32,
            cpu_logical_cores: sys.cpus().len() as u32,
            cpu_freq_mhz: first_cpu.map(|c| c.frequency()).unwrap_or(0),
            mem_total_bytes: sys.total_memory(),
            swap_total_bytes: sys.total_swap(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probes_the_real_machine() {
        let facts = HostFacts::probe(None);
        assert!(!facts.hostname.is_empty());
        assert!(facts.cpu_logical_cores > 0, "a machine running tests has at least one core");
        assert!(facts.mem_total_bytes > 0);
        assert_eq!(facts.node_name, facts.hostname, "node name defaults to the hostname");
    }

    #[test]
    fn configured_name_overrides_the_hostname() {
        let facts = HostFacts::probe(Some("jupiter"));
        assert_eq!(facts.node_name, "jupiter");
    }
}
