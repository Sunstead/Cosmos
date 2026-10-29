//! Just enough X.509 to read a certificate's serial number and validity,
//! without pulling in a parser crate for three fields.
//!
//! ```text
//! Certificate ::= SEQUENCE {
//!     tbsCertificate SEQUENCE {
//!         version      [0] EXPLICIT INTEGER OPTIONAL,
//!         serialNumber INTEGER,
//!         signature    AlgorithmIdentifier (SEQUENCE),
//!         issuer       Name (SEQUENCE),
//!         validity     SEQUENCE { notBefore Time, notAfter Time },
//!         ...
//! ```

use crate::backups::days_from_civil;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CertValidity {
    /// Hex, identifying this certificate among renewals.
    pub serial: String,
    pub not_before: i64,
    pub not_after: i64,
}

const SEQUENCE: u8 = 0x30;
const INTEGER: u8 = 0x02;
const VERSION: u8 = 0xa0;
const UTC_TIME: u8 = 0x17;
const GENERALIZED_TIME: u8 = 0x18;

/// One tag-length-value: the tag, its contents, and what follows it.
fn tlv(buf: &[u8]) -> Option<(u8, &[u8], &[u8])> {
    let (&tag, rest) = buf.split_first()?;
    let (&first, rest) = rest.split_first()?;
    let (len, rest) = if first < 0x80 {
        (usize::from(first), rest)
    } else {
        let n = usize::from(first & 0x7f);
        if n == 0 || n > 4 || rest.len() < n {
            return None;
        }
        let len = rest[..n].iter().fold(0usize, |acc, &b| (acc << 8) | usize::from(b));
        (len, &rest[n..])
    };
    if rest.len() < len {
        return None;
    }
    Some((tag, &rest[..len], &rest[len..]))
}

fn expect(buf: &[u8], want: u8) -> Option<(&[u8], &[u8])> {
    let (tag, body, rest) = tlv(buf)?;
    (tag == want).then_some((body, rest))
}

fn time(buf: &[u8]) -> Option<(i64, &[u8])> {
    let (tag, body, rest) = tlv(buf)?;
    let s = std::str::from_utf8(body).ok()?;
    let digits = |r: std::ops::Range<usize>| -> Option<i64> { s.get(r)?.parse().ok() };
    let (year, rest_at) = match tag {
        // Two-digit years: 50 and up are the 1900s (RFC 5280).
        UTC_TIME => {
            let yy = digits(0..2)?;
            (if yy >= 50 { 1900 + yy } else { 2000 + yy }, 2)
        }
        GENERALIZED_TIME => (digits(0..4)?, 4),
        _ => {
            return None;
        }
    };
    let at = |i: usize| digits(rest_at + i..rest_at + i + 2);
    let (month, day, hour, min, sec) = (at(0)?, at(2)?, at(4)?, at(6)?, at(8)?);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let secs = days_from_civil(year, month, day) * 86_400 + hour * 3_600 + min * 60 + sec;
    Some((secs, rest))
}

pub fn validity(der: &[u8]) -> Option<CertValidity> {
    let (cert, _) = expect(der, SEQUENCE)?;
    let (tbs, _) = expect(cert, SEQUENCE)?;
    let tbs = match tlv(tbs)? {
        (VERSION, _, rest) => rest,
        _ => tbs,
    };
    let (serial, rest) = expect(tbs, INTEGER)?;
    let (_algorithm, rest) = expect(rest, SEQUENCE)?;
    let (_issuer, rest) = expect(rest, SEQUENCE)?;
    let (validity, _) = expect(rest, SEQUENCE)?;
    let (not_before, rest) = time(validity)?;
    let (not_after, _) = time(rest)?;
    let serial = serial
        .iter()
        .skip_while(|&&b| b == 0)
        .map(|b| format!("{b:02x}"))
        .collect();
    Some(CertValidity { serial, not_before, not_after })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_real_certificate() {
        let v = validity(include_bytes!("testdata/cert.der")).expect("parses");
        assert_eq!(v.serial, "1234abcd");
        assert_eq!(v.not_before, 1_790_447_002); // 2026-09-26 18:23:22 UTC
        assert_eq!(v.not_after, 1_798_223_002); // 2026-12-25 18:23:22 UTC
    }

    #[test]
    fn reads_both_time_forms() {
        let utc = [UTC_TIME, 13, b'4', b'9', b'1', b'2', b'3', b'1', b'2', b'3', b'5', b'9', b'5', b'9', b'Z'];
        assert_eq!(time(&utc).unwrap().0, 2_524_607_999);
        let gen = b"\x18\x0f20500101000000Z";
        assert_eq!(time(gen).unwrap().0, 2_524_608_000);
    }

    #[test]
    fn rejects_garbage_without_panicking() {
        let real = include_bytes!("testdata/cert.der");
        for n in 0..real.len() {
            let _ = validity(&real[..n]);
        }
        assert_eq!(validity(b""), None);
        assert_eq!(validity(&[0x30, 0x84, 0xff, 0xff, 0xff, 0xff]), None);
    }
}
