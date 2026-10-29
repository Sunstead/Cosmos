//! Disk I/O counters on Linux, found by device number.
//!
//! sysinfo finds a disk's counters by canonicalizing its device path
//! (`/dev/sda1`) and looking the name up in `/proc/diskstats`. The agent's
//! distroless image has no host block devices under `/dev`, so the lookup
//! always missed and every disk read 0 B/s (and `/dev/mapper/*` would miss
//! even with them, since diskstats calls those `dm-N`). The kernel already
//! says which device backs each mount: field 3 of `/proc/self/mountinfo` is
//! its `major:minor`, which is also how diskstats identifies a device. Neither
//! file needs `/dev`, and diskstats isn't namespaced, so it lists the host's
//! devices.

use std::collections::HashMap;

/// diskstats counts 512-byte sectors whatever the device's real sector size.
const SECTOR_SIZE: u64 = 512;

/// `(major, minor)`.
pub type DevNum = (u32, u32);

/// The device behind a mount, from one mountinfo line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MountDev {
    pub dev: DevNum,
    /// The mount source (`/dev/sda1`, `overlay`, `server:/export`).
    pub source: String,
}

/// Cumulative bytes since boot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct IoCounters {
    pub read_bytes: u64,
    pub written_bytes: u64,
}

/// Mount point -> device, from `/proc/self/mountinfo`:
///
/// ```text
/// 1094 1021 8:1 / /host/rootfs/srv/storage ro,relatime master:91 - ext4 /dev/sda1 rw
/// ```
///
/// Mount points are octal-escaped (`\040` for a space), as in
/// `/proc/mounts`, which is where sysinfo's mount points come from.
pub fn parse_mountinfo(text: &str) -> HashMap<String, MountDev> {
    let mut out = HashMap::new();
    for line in text.lines() {
        // Optional fields come before the ` - ` separator; spaces inside
        // paths are escaped, so it can't appear anywhere else.
        let Some((head, tail)) = line.split_once(" - ") else {
            continue;
        };
        let mut head = head.split(' ');
        let (Some(dev), Some(mount)) = (head.nth(2), head.nth(1)) else {
            continue;
        };
        let Some(dev) = parse_dev(dev) else {
            continue;
        };
        // After the separator: filesystem type, mount source, super options.
        let source = tail.split(' ').nth(1).map(unescape).unwrap_or_default();
        // A later line for the same mount point is mounted over the earlier
        // one, and is the one paths resolve to.
        out.insert(unescape(mount), MountDev { dev, source });
    }
    out
}

fn parse_dev(s: &str) -> Option<DevNum> {
    let (major, minor) = s.split_once(':')?;
    Some((major.parse().ok()?, minor.parse().ok()?))
}

/// Undoes the kernel's octal escaping (`\040` space, `\011` tab, `\012`
/// newline, `\134` backslash).
fn unescape(s: &str) -> String {
    if !s.contains('\\') {
        return s.to_string();
    }
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'\\' && i + 3 < b.len() && b[i + 1..=i + 3].iter().all(|c| (b'0'..=b'7').contains(c)) {
            let n = b[i + 1..=i + 3].iter().fold(0u32, |n, c| n * 8 + u32::from(c - b'0'));
            if let Ok(byte) = u8::try_from(n) {
                out.push(byte);
                i += 4;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// One read of `/proc/diskstats`.
#[derive(Debug, Default)]
pub struct DiskStats {
    by_dev: HashMap<DevNum, IoCounters>,
    by_name: HashMap<String, DevNum>,
}

/// ```text
///    8       1 sda1 11012737 29734 3388420914 33211537 3913403 7583180 155081248 ...
/// ```
///
/// Fields 6 and 10 are sectors read and written.
pub fn parse_diskstats(text: &str) -> DiskStats {
    let mut stats = DiskStats::default();
    for line in text.lines() {
        let f: Vec<&str> = line.split_whitespace().collect();
        if f.len() < 10 {
            continue;
        }
        let (Ok(major), Ok(minor), Ok(read), Ok(written)) = (
            f[0].parse::<u32>(),
            f[1].parse::<u32>(),
            f[5].parse::<u64>(),
            f[9].parse::<u64>(),
        ) else {
            continue;
        };
        let dev = (major, minor);
        stats.by_dev.insert(dev, IoCounters {
            read_bytes: read.saturating_mul(SECTOR_SIZE),
            written_bytes: written.saturating_mul(SECTOR_SIZE),
        });
        stats.by_name.insert(f[2].to_string(), dev);
    }
    stats
}

impl DiskStats {
    /// Counters for the device behind a mount, if it has any.
    ///
    /// Filesystems with no single block device (btrfs, ZFS, NFS, overlay) get
    /// an anonymous `0:N` device number. For those the mount source's name is
    /// tried instead (btrfs on `/dev/sdb1` is `sdb1` here); a source outside
    /// `/dev` is never a block device, so it has no counters.
    pub fn counters(&self, m: &MountDev) -> Option<IoCounters> {
        if let Some(c) = self.by_dev.get(&m.dev) {
            return Some(*c);
        }
        let name = m.source.strip_prefix("/dev/")?.rsplit('/').next()?;
        self.by_dev.get(self.by_name.get(name)?).copied()
    }
}

/// What the host sampler keeps between ticks.
#[derive(Debug, Default)]
pub struct DiskIo {
    mounts: HashMap<String, MountDev>,
    stats: DiskStats,
    /// Whether the mount table was read this tick, so a mount it doesn't know
    /// re-reads it at most once per tick.
    mounts_fresh: bool,
}

impl DiskIo {
    pub fn new() -> Self {
        let mut io = Self::default();
        io.refresh(true);
        io
    }

    /// Once per tick. The mount table only changes on (un)mount, so it's read
    /// on re-enumeration; the counters are read every time. Both files are a
    /// few kilobytes.
    pub fn refresh(&mut self, reenumerate: bool) {
        self.mounts_fresh = false;
        if reenumerate || self.mounts.is_empty() {
            self.reload_mounts();
        }
        self.stats = read_proc("/proc/diskstats").map(|t| parse_diskstats(&t)).unwrap_or_default();
    }

    fn reload_mounts(&mut self) {
        self.mounts = read_proc("/proc/self/mountinfo").map(|t| parse_mountinfo(&t)).unwrap_or_default();
        self.mounts_fresh = true;
    }

    /// Counters for a mount point as sysinfo reports it. A mount that
    /// appeared since the table was read triggers one re-read.
    pub fn counters(&mut self, mount: &str) -> Option<IoCounters> {
        if !self.mounts_fresh && !self.mounts.contains_key(mount) {
            self.reload_mounts();
        }
        self.stats.counters(self.mounts.get(mount)?)
    }

    /// From file contents, with no reads of its own.
    #[cfg(test)]
    pub fn from_text(mountinfo: &str, diskstats: &str) -> Self {
        Self { mounts: parse_mountinfo(mountinfo), stats: parse_diskstats(diskstats), mounts_fresh: true }
    }

    /// The next tick's counters, in tests.
    #[cfg(test)]
    pub fn set_diskstats(&mut self, diskstats: &str) {
        self.stats = parse_diskstats(diskstats);
    }
}

fn read_proc(path: &str) -> Option<String> {
    std::fs
        ::read_to_string(path)
        .inspect_err(|e| tracing::debug!(path, error = %e, "cannot read disk I/O counters"))
        .ok()
}

#[cfg(test)]
pub mod fixtures {
    pub const JUPITER_MOUNTINFO: &str = include_str!("fixtures/jupiter-mountinfo");
    pub const JUPITER_DISKSTATS: &str = include_str!("fixtures/jupiter-diskstats");
}

#[cfg(test)]
mod tests {
    use super::{ fixtures::*, * };

    #[test]
    fn jupiter_mounts_map_to_their_devices() {
        let mounts = parse_mountinfo(JUPITER_MOUNTINFO);
        let dev = |m: &str| mounts.get(m).map(|d| d.dev);
        assert_eq!(dev("/host/rootfs"), Some((259, 5)));
        assert_eq!(dev("/host/rootfs/srv/storage"), Some((8, 1)));
        assert_eq!(dev("/host/rootfs/boot/efi"), Some((259, 4)));
        assert_eq!(dev("/"), Some((0, 53)));
        assert_eq!(mounts["/host/rootfs/srv/storage"].source, "/dev/sda1");
        assert_eq!(mounts["/"].source, "overlay");
    }

    #[test]
    fn jupiter_charted_disks_have_counters() {
        let mounts = parse_mountinfo(JUPITER_MOUNTINFO);
        let stats = parse_diskstats(JUPITER_DISKSTATS);
        let io = |m: &str| stats.counters(&mounts[m]);

        // nvme0n1p5: 89384882 sectors read, 2160798232 written.
        assert_eq!(
            io("/host/rootfs"),
            Some(IoCounters { read_bytes: 89_384_882 * 512, written_bytes: 2_160_798_232 * 512 })
        );
        // sda1: 3388420914 read, 155081248 written.
        assert_eq!(
            io("/host/rootfs/srv/storage"),
            Some(IoCounters { read_bytes: 3_388_420_914 * 512, written_bytes: 155_081_248 * 512 })
        );
        // Bind mounts of the root filesystem share its counters.
        assert_eq!(io("/var/lib/cosmos-agent"), io("/host/rootfs"));
        // Virtual filesystems have none.
        assert_eq!(io("/"), None);
        assert_eq!(io("/host/rootfs/tmp"), None);
        assert_eq!(io("/host/rootfs/proc"), None);
    }

    #[test]
    fn anonymous_devices_fall_back_to_the_source_name() {
        // btrfs subvolumes get an anonymous 0:N device.
        let mounts = parse_mountinfo(
            "40 1 0:41 /@home /home rw,relatime shared:2 - btrfs /dev/sda1 rw,ssd,subvol=/@home\n\
             41 1 0:42 / /mnt/nas rw,relatime - nfs4 nas:/export/sda1 rw\n\
             42 1 0:43 / /tank rw - zfs tank rw\n"
        );
        let stats = parse_diskstats(JUPITER_DISKSTATS);
        assert_eq!(stats.counters(&mounts["/home"]).map(|c| c.written_bytes), Some(155_081_248 * 512));
        // Only `/dev` sources are block devices, whatever their last component.
        assert_eq!(stats.counters(&mounts["/mnt/nas"]), None);
        assert_eq!(stats.counters(&mounts["/tank"]), None);
    }

    #[test]
    fn mount_points_are_unescaped() {
        let mounts = parse_mountinfo(
            "50 1 8:17 / /mnt/My\\040Drive rw - ext4 /dev/sdb1 rw\n\
             51 1 8:18 / /mnt/tab\\011and\\134slash rw - ext4 /dev/sdb2 rw\n"
        );
        assert_eq!(mounts["/mnt/My Drive"].dev, (8, 17));
        assert_eq!(mounts["/mnt/tab\tand\\slash"].dev, (8, 18));
        // Not an escape: left alone.
        assert_eq!(unescape("a\\9b\\0"), "a\\9b\\0");
        assert_eq!(unescape("plain"), "plain");
    }

    #[test]
    fn a_later_mount_on_the_same_point_wins() {
        let mounts = parse_mountinfo(
            "60 1 8:1 / /data rw - ext4 /dev/sda1 rw\n\
             61 60 8:17 / /data rw - ext4 /dev/sdb1 rw\n"
        );
        assert_eq!(mounts["/data"].dev, (8, 17));
    }

    #[test]
    fn malformed_lines_are_skipped() {
        assert!(parse_mountinfo("garbage\n1 2 x:y / /a rw - ext4 /dev/sda rw\n\n").is_empty());
        let stats = parse_diskstats("   8 0 sda 1 2\nnot numbers at all here x y z w v u\n");
        assert!(stats.by_dev.is_empty());
    }

    #[test]
    fn an_unknown_mount_has_no_counters() {
        let mut io = DiskIo::from_text(JUPITER_MOUNTINFO, JUPITER_DISKSTATS);
        assert!(io.counters("/host/rootfs").is_some());
        assert_eq!(io.counters("/nowhere"), None);
    }
}
