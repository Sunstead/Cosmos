//! Wake-on-LAN: magic packets, target validation, and the LAN facts the UI
//! offers when adding a target (broadcast addresses, the ARP table).
//!
//! The agent runs with host networking, so a broadcast from here reaches the
//! LAN directly. Sending UDP to a broadcast address needs `SO_BROADCAST`, not
//! any capability, so this works under `cap_drop: [ALL]`.

use crate::error::AgentError;
use cosmos_common::types::{ WolNeighbor, WolNetwork, WolProbe, WolTarget, WolTargetInput };
use std::net::{ Ipv4Addr, SocketAddrV4 };

const SYNC: [u8; 6] = [0xff; 6];
const MAC_REPEATS: usize = 16;
const DEFAULT_PORT: u16 = 9;
const MAX_NAME: usize = 64;

/// `aa:bb:cc:dd:ee:ff` from any common spelling: colons, dashes, dots
/// (`aabb.ccdd.eeff`) or none, any case.
pub fn normalise_mac(raw: &str) -> Result<String, AgentError> {
    let hex: String = raw
        .trim()
        .chars()
        .filter(|c| !matches!(c, ':' | '-' | '.'))
        .collect::<String>()
        .to_ascii_lowercase();
    if hex.len() != 12 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AgentError::BadRequest(format!("{raw:?} is not a MAC address")));
    }
    if hex == "000000000000" || hex == "ffffffffffff" {
        return Err(AgentError::BadRequest(format!("{raw:?} is not a device's MAC address")));
    }
    Ok(
        hex
            .as_bytes()
            .chunks(2)
            .map(|pair| std::str::from_utf8(pair).unwrap())
            .collect::<Vec<_>>()
            .join(":")
    )
}

/// Six `0xFF` bytes, then the MAC sixteen times.
pub fn magic_packet(mac: &str) -> Result<[u8; 102], AgentError> {
    let normalised = normalise_mac(mac)?;
    let mut bytes = [0u8; 6];
    for (i, part) in normalised.split(':').enumerate() {
        bytes[i] = u8::from_str_radix(part, 16).expect("normalised");
    }
    let mut packet = [0u8; 102];
    packet[..6].copy_from_slice(&SYNC);
    for i in 0..MAC_REPEATS {
        packet[6 + i * 6..12 + i * 6].copy_from_slice(&bytes);
    }
    Ok(packet)
}

/// Where a target's packet goes.
pub fn destination(t: &WolTarget) -> SocketAddrV4 {
    let ip = t.broadcast
        .as_deref()
        .and_then(|b| b.parse().ok())
        .unwrap_or(Ipv4Addr::BROADCAST);
    SocketAddrV4::new(ip, t.port)
}

pub async fn send(t: &WolTarget) -> Result<SocketAddrV4, AgentError> {
    let packet = magic_packet(&t.mac)?;
    let to = destination(t);
    let socket = tokio::net::UdpSocket
        ::bind((Ipv4Addr::UNSPECIFIED, 0)).await
        .map_err(|e| AgentError::Unavailable(format!("cannot open a UDP socket: {e}")))?;
    socket
        .set_broadcast(true)
        .map_err(|e| AgentError::Unavailable(format!("cannot enable broadcast: {e}")))?;
    socket
        .send_to(&packet, to).await
        .map_err(|e| AgentError::Unavailable(format!("cannot send to {to}: {e}")))?;
    Ok(to)
}

/// Checks and normalises what the UI sent. `id` is filled in by the caller.
pub fn validate(input: WolTargetInput, id: String) -> Result<WolTarget, AgentError> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(AgentError::BadRequest("a target needs a name".into()));
    }
    if name.chars().count() > MAX_NAME {
        return Err(AgentError::BadRequest(format!("names are at most {MAX_NAME} characters")));
    }

    let broadcast = match input.broadcast.as_deref().map(str::trim).filter(|b| !b.is_empty()) {
        None => None,
        Some(b) => {
            let ip: Ipv4Addr = b
                .parse()
                .map_err(|_| AgentError::BadRequest(format!("{b:?} is not an IPv4 address")))?;
            // Loopback stays allowed: it's how the e2e suite catches the
            // packet, and it harms nothing.
            if ip.is_unspecified() {
                return Err(AgentError::BadRequest(format!("{b} is not a destination")));
            }
            Some(ip.to_string())
        }
    };

    let port = input.port.unwrap_or(DEFAULT_PORT);
    if port == 0 {
        return Err(AgentError::BadRequest("port must be between 1 and 65535".into()));
    }

    let probe = match input.probe {
        None => None,
        Some(WolProbe { host, port }) => {
            let host = host.trim().to_string();
            if host.is_empty() || port == 0 {
                return Err(AgentError::BadRequest("a probe needs a host and a port".into()));
            }
            Some(WolProbe { host, port })
        }
    };

    Ok(WolTarget {
        id,
        name,
        mac: normalise_mac(&input.mac)?,
        broadcast,
        port,
        tailnet_device: input.tailnet_device
            .map(|d| d.trim().to_string())
            .filter(|d| !d.is_empty()),
        probe,
    })
}

/// IPv4 networks on allowed interfaces, with their broadcast addresses.
pub fn networks(allowed: impl Fn(&str) -> bool) -> Vec<WolNetwork> {
    let list = sysinfo::Networks::new_with_refreshed_list();
    let mut out: Vec<WolNetwork> = list
        .iter()
        .filter(|(name, _)| allowed(name))
        .flat_map(|(name, data)| {
            data.ip_networks()
                .iter()
                .filter_map(move |net| {
                    let std::net::IpAddr::V4(ip) = net.addr else {
                        return None;
                    };
                    network_for(name, ip, net.prefix)
                })
        })
        .collect();
    out.sort_by(|a, b| a.interface.cmp(&b.interface).then(a.cidr.cmp(&b.cidr)));
    out.dedup();
    out
}

fn network_for(interface: &str, ip: Ipv4Addr, prefix: u8) -> Option<WolNetwork> {
    // Point-to-point and host routes have no broadcast worth offering, and
    // neither do loopback, link-local or Tailscale's CGNAT range.
    if prefix == 0 || prefix >= 31 || ip.is_loopback() || ip.is_link_local() {
        return None;
    }
    let octets = ip.octets();
    if octets[0] == 100 && (64..128).contains(&octets[1]) {
        return None;
    }
    let mask = u32::MAX << (32 - prefix);
    let broadcast = Ipv4Addr::from(u32::from(ip) | !mask);
    Some(WolNetwork {
        interface: interface.to_string(),
        cidr: format!("{ip}/{prefix}"),
        broadcast: broadcast.to_string(),
    })
}

/// Complete entries from a Linux `/proc/net/arp`, which (under host
/// networking) is the host's own table.
pub fn parse_arp(table: &str, allowed: impl Fn(&str) -> bool) -> Vec<WolNeighbor> {
    const ATF_COM: u32 = 0x2;
    let mut out: Vec<WolNeighbor> = table
        .lines()
        .skip(1)
        .filter_map(|line| {
            let cols: Vec<&str> = line.split_whitespace().collect();
            let [ip, _hw, flags, mac, _mask, dev] = cols[..] else {
                return None;
            };
            let flags = u32::from_str_radix(flags.trim_start_matches("0x"), 16).ok()?;
            if flags & ATF_COM == 0 || !allowed(dev) {
                return None;
            }
            let mac = normalise_mac(mac).ok()?;
            Some(WolNeighbor { ip: ip.to_string(), mac, interface: dev.to_string() })
        })
        .collect();
    out.sort_by_key(|n| n.ip.parse::<Ipv4Addr>().map(u32::from).unwrap_or(u32::MAX));
    out
}

pub async fn neighbors(allowed: impl Fn(&str) -> bool) -> Result<Vec<WolNeighbor>, AgentError> {
    match tokio::fs::read_to_string("/proc/net/arp").await {
        Ok(table) => Ok(parse_arp(&table, allowed)),
        // macOS in development: no /proc. Not an error worth surfacing.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(AgentError::Unavailable(format!("cannot read the ARP table: {e}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalises_every_common_mac_spelling() {
        for raw in ["AA:BB:CC:DD:EE:FF", "aa-bb-cc-dd-ee-ff", "aabb.ccdd.eeff", " aabbccddeeff "] {
            assert_eq!(normalise_mac(raw).unwrap(), "aa:bb:cc:dd:ee:ff", "{raw}");
        }
    }

    #[test]
    fn rejects_bad_macs() {
        for raw in ["", "aa:bb:cc:dd:ee", "aa:bb:cc:dd:ee:ff:00", "gg:bb:cc:dd:ee:ff", "00:00:00:00:00:00", "ff:ff:ff:ff:ff:ff"] {
            assert!(normalise_mac(raw).is_err(), "{raw}");
        }
    }

    #[test]
    fn builds_the_magic_packet() {
        let p = magic_packet("01:23:45:67:89:ab").unwrap();
        assert_eq!(&p[..6], &[0xff; 6]);
        for i in 0..16 {
            assert_eq!(&p[6 + i * 6..12 + i * 6], &[0x01, 0x23, 0x45, 0x67, 0x89, 0xab]);
        }
    }

    fn input(mac: &str) -> WolTargetInput {
        WolTargetInput {
            name: " Desktop ".into(),
            mac: mac.into(),
            broadcast: None,
            port: None,
            tailnet_device: Some("  ".into()),
            probe: None,
        }
    }

    #[test]
    fn validation_normalises_and_defaults() {
        let t = validate(input("AA-BB-CC-DD-EE-FF"), "1".into()).unwrap();
        assert_eq!(t.name, "Desktop");
        assert_eq!(t.mac, "aa:bb:cc:dd:ee:ff");
        assert_eq!(t.port, 9);
        assert_eq!(t.broadcast, None);
        assert_eq!(t.tailnet_device, None, "blank means unlinked");
        assert_eq!(destination(&t), SocketAddrV4::new(Ipv4Addr::BROADCAST, 9));
    }

    #[test]
    fn validation_rejects_nonsense() {
        let mut i = input("aa:bb:cc:dd:ee:ff");
        i.name = "   ".into();
        assert!(validate(i, "1".into()).is_err());

        let mut i = input("aa:bb:cc:dd:ee:ff");
        i.broadcast = Some("not-an-ip".into());
        assert!(validate(i, "1".into()).is_err());

        let mut i = input("aa:bb:cc:dd:ee:ff");
        i.port = Some(0);
        assert!(validate(i, "1".into()).is_err());

        let mut i = input("aa:bb:cc:dd:ee:ff");
        i.probe = Some(WolProbe { host: "".into(), port: 3389 });
        assert!(validate(i, "1".into()).is_err());
    }

    #[test]
    fn computes_subnet_broadcasts_and_skips_tailscale() {
        let n = network_for("eth0", Ipv4Addr::new(192, 168, 1, 10), 24).unwrap();
        assert_eq!(n.broadcast, "192.168.1.255");
        assert_eq!(n.cidr, "192.168.1.10/24");
        assert_eq!(network_for("eth0", Ipv4Addr::new(10, 0, 5, 1), 22).unwrap().broadcast, "10.0.7.255");
        assert!(network_for("tailscale0", Ipv4Addr::new(100, 64, 0, 1), 32).is_none());
        assert!(network_for("x", Ipv4Addr::new(100, 100, 1, 1), 24).is_none());
        assert!(network_for("lo", Ipv4Addr::LOCALHOST, 8).is_none());
    }

    #[test]
    fn parses_complete_arp_entries() {
        let table = "\
IP address       HW type     Flags       HW address            Mask     Device
192.168.1.20     0x1         0x2         aa:bb:cc:dd:ee:ff     *        eth0
192.168.1.3      0x1         0x2         11:22:33:44:55:66     *        eth0
192.168.1.99     0x1         0x0         00:00:00:00:00:00     *        eth0
172.17.0.2       0x1         0x2         02:42:ac:11:00:02     *        docker0
";
        let n = parse_arp(table, |d| d != "docker0");
        assert_eq!(
            n.iter()
                .map(|n| n.ip.as_str())
                .collect::<Vec<_>>(),
            ["192.168.1.3", "192.168.1.20"]
        );
        assert_eq!(n[1].mac, "aa:bb:cc:dd:ee:ff");
    }

    #[tokio::test]
    async fn sends_a_magic_packet_over_udp() {
        let listener = tokio::net::UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let target = WolTarget {
            id: "1".into(),
            name: "desktop".into(),
            mac: "aa:bb:cc:dd:ee:ff".into(),
            broadcast: Some("127.0.0.1".into()),
            port,
            tailnet_device: None,
            probe: None,
        };
        send(&target).await.unwrap();

        let mut buf = [0u8; 200];
        let (n, _) = listener.recv_from(&mut buf).await.unwrap();
        assert_eq!(&buf[..n], &magic_packet("aa:bb:cc:dd:ee:ff").unwrap());
    }
}
