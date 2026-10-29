//! Version tags: which tags are newer versions of the one running, and how
//! big a change each is.
//!
//! A tag is an optional `v`, a dotted number, and whatever follows. Only a
//! tag of the same shape counts as a candidate: the same `v`, as many
//! numbers, and the identical rest. So `16.15-alpine` moves to `16.16-alpine`
//! and never to `17beta1-alpine`, `16-alpine` or `16.15-bookworm`, and
//! release candidates (`v3.3.0-rc.1`) never replace a release.

use cosmos_common::types::ChangeKind;
use std::cmp::Ordering;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version {
    v: bool,
    pub nums: Vec<u64>,
    suffix: String,
}

impl Version {
    pub fn parse(tag: &str) -> Option<Self> {
        let (v, rest) = match tag.strip_prefix('v') {
            Some(rest) => (true, rest),
            None => (false, tag),
        };
        let mut nums = Vec::new();
        let mut rest = rest;
        loop {
            let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
            if digits == 0 || digits > 18 {
                return None;
            }
            nums.push(rest[..digits].parse().ok()?);
            rest = &rest[digits..];
            // Another number only when a digit follows the dot: `1.2.` is 1.2
            // with suffix `.`.
            match rest.strip_prefix('.') {
                Some(next) if next.starts_with(|c: char| c.is_ascii_digit()) => {
                    rest = next;
                }
                _ => {
                    break;
                }
            }
        }
        Some(Self { v, nums, suffix: rest.to_string() })
    }

    pub fn same_shape(&self, other: &Self) -> bool {
        self.v == other.v && self.nums.len() == other.nums.len() && self.suffix == other.suffix
    }

    /// How many leading numbers make the major version: `major_digits`, and
    /// on `0.x` one more, since a 0.x minor is allowed to break things.
    fn major_width(&self, major_digits: usize) -> usize {
        let width = major_digits.max(1);
        if width == 1 && self.nums.first() == Some(&0) && self.nums.len() > 1 { 2 } else { width }
    }

    /// The change from `self` to `to`, or `None` if `to` isn't newer.
    pub fn change_to(&self, to: &Self, major_digits: usize) -> Option<ChangeKind> {
        if !self.same_shape(to) || to.nums.cmp(&self.nums) != Ordering::Greater {
            return None;
        }
        let first = self.nums
            .iter()
            .zip(&to.nums)
            .position(|(a, b)| a != b)?;
        Some(if first < self.major_width(major_digits) {
            ChangeKind::Major
        } else if first == self.nums.len() - 1 {
            ChangeKind::Patch
        } else {
            ChangeKind::Minor
        })
    }

    /// How many majors `to` is ahead: 1 for the next one.
    pub fn majors_ahead(&self, to: &Self, major_digits: usize) -> u64 {
        let width = self.major_width(major_digits).min(self.nums.len());
        // The last number of the major part counts majors; any change before
        // it (a new year for calendar versions) counts as one more.
        let (a, b) = (&self.nums[..width], &to.nums[..width]);
        if a[..width - 1] != b[..width - 1] {
            return 1 + b[width - 1];
        }
        b[width - 1].saturating_sub(a[width - 1])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn change(from: &str, to: &str) -> Option<ChangeKind> {
        Version::parse(from).unwrap().change_to(&Version::parse(to).unwrap(), 1)
    }

    fn change_by(from: &str, to: &str, digits: usize) -> Option<ChangeKind> {
        Version::parse(from).unwrap().change_to(&Version::parse(to).unwrap(), digits)
    }

    #[test]
    fn classifies_every_tag_jupiter_runs() {
        use ChangeKind::*;
        // caddy, portainer, gitea
        assert_eq!(change("2.11.4", "2.11.5"), Some(Patch));
        assert_eq!(change("2.11.4", "2.12.0"), Some(Minor));
        assert_eq!(change("2.45.1", "3.0.0"), Some(Major));
        // postgres and redis: two numbers means the second is the patch.
        assert_eq!(change("16.15-alpine", "16.16-alpine"), Some(Patch));
        assert_eq!(change("16.15-alpine", "17.6-alpine"), Some(Major));
        assert_eq!(change("7.4.11-alpine", "7.4.12-alpine"), Some(Patch));
        assert_eq!(change("7.4.11-alpine", "8.2.3-alpine"), Some(Major));
        // tailscale, immich, ntfy: v-prefixed
        assert_eq!(change("v1.102.4", "v1.102.5"), Some(Patch));
        assert_eq!(change("v3.2.2", "v3.3.0"), Some(Minor));
        assert_eq!(change("v2.28.0", "v2.28.1"), Some(Patch));
        // nextcloud
        assert_eq!(change("35.0.0-apache", "35.0.1-apache"), Some(Patch));
        assert_eq!(change("35.0.0-apache", "36.0.0-apache"), Some(Major));
        // authentik and gitea: the first two numbers are the release.
        assert_eq!(change_by("2026.5.2", "2026.5.3", 2), Some(Patch));
        assert_eq!(change_by("2026.5.2", "2026.8.0", 2), Some(Major));
        assert_eq!(change_by("1.27.3", "1.28.0", 2), Some(Major));
        // cosmos-agent: on 0.x a minor is a major.
        assert_eq!(change("0.5.1", "0.5.2"), Some(Patch));
        assert_eq!(change("0.5.1", "0.6.0"), Some(Major));
    }

    #[test]
    fn only_the_same_shape_is_a_candidate() {
        for other in ["16-alpine", "16.16-bookworm", "17beta1-alpine", "16.16", "v16.16-alpine", "16.16.1-alpine"] {
            assert_eq!(change("16.15-alpine", other), None, "{other}");
        }
        assert_eq!(change("v3.2.2", "v3.3.0-rc.1"), None);
        assert_eq!(change("1.27.3", "1.27.3-rootless"), None);
        assert_eq!(Version::parse("stable-apache"), None);
        assert_eq!(Version::parse("latest"), None);
        assert_eq!(Version::parse("commit-283067e38df0f05c21317117ba2923d8fe301858"), None);
    }

    #[test]
    fn older_or_equal_is_not_an_update() {
        assert_eq!(change("2.11.4", "2.11.4"), None);
        assert_eq!(change("2.11.4", "2.10.9"), None);
        assert_eq!(change("v3.2.2", "v3.2.10"), Some(ChangeKind::Patch), "numbers compare as numbers");
    }

    #[test]
    fn keeps_the_rest_of_a_complicated_tag() {
        let v = Version::parse("18-vectorchord0.5.3-pgvector0.8.1").unwrap();
        assert_eq!(v.nums, [18]);
        assert!(!v.same_shape(&Version::parse("18-vectorchord0.5.4-pgvector0.8.1").unwrap()));
    }

    #[test]
    fn counts_majors_ahead() {
        let p = |s: &str| Version::parse(s).unwrap();
        assert_eq!(p("35.0.0-apache").majors_ahead(&p("36.0.2-apache"), 1), 1);
        assert_eq!(p("35.0.0-apache").majors_ahead(&p("37.0.0-apache"), 1), 2);
        assert_eq!(p("2026.5.2").majors_ahead(&p("2026.8.0"), 2), 3);
        assert_eq!(p("0.5.1").majors_ahead(&p("0.6.0"), 1), 1);
    }
}
