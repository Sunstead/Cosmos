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
    /// Empty means "report every filesystem with a non-zero size".
    disk_labels: HashMap<String, String>,
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

    /// `Some(label)` if this mount should be reported. With no configured
    /// disks every mount passes through under its own name, which is the
    /// right default when running directly on a host.
    pub fn disk_label(&self, mount: &str) -> Option<String> {
        if self.disk_labels.is_empty() {
            return Some(mount.to_string());
        }
        self.disk_labels.get(mount).cloned()
    }

    /// Hint for `Vec::with_capacity`.
    pub fn disk_hint(&self) -> usize {
        self.disk_labels.len().max(4)
    }
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
        assert_eq!(f.disk_label("/"), Some("/".to_string()));
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

        assert_eq!(f.disk_label("/host/rootfs"), Some("/".to_string()));
        // No label configured: fall back to the path itself.
        assert_eq!(f.disk_label("/host/mnt/tank"), Some("/host/mnt/tank".to_string()));
        // Container noise stays out.
        assert_eq!(f.disk_label("/var/lib/docker/overlay2/abc"), None);
        assert_eq!(f.disk_label("/etc/resolv.conf"), None);
    }
}
