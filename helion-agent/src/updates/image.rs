//! Image references as compose writes them: `postgres:16.15-alpine`,
//! `binwiederhier/ntfy:v2.28.0`, `ghcr.io/immich-app/immich-server:v3.2.2`.

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ImageRef {
    /// The repository as written, without the tag: what compose and the
    /// update workflow match on.
    pub repo: String,
    /// The registry host to ask, e.g. `registry-1.docker.io`, `ghcr.io`.
    pub registry: String,
    /// The path within the registry, e.g. `library/postgres`.
    pub path: String,
    pub tag: String,
}

impl ImageRef {
    /// `None` for a digest reference, an image ID, or no tag: nothing to
    /// compare against.
    pub fn parse(image: &str) -> Option<Self> {
        let image = image.trim();
        if image.is_empty() || image.contains('@') || image.starts_with("sha256:") {
            return None;
        }
        // The tag is after the last colon, unless that colon is in the host
        // (localhost:5000/app has no tag).
        let (repo, tag) = match image.rsplit_once(':') {
            Some((repo, tag)) if !tag.contains('/') => (repo, tag),
            _ => {
                return None;
            }
        };
        if tag.is_empty() || repo.is_empty() {
            return None;
        }
        let (registry, path) = match repo.split_once('/') {
            Some((host, rest)) if host.contains('.') || host.contains(':') || host == "localhost" => {
                let registry = if host == "docker.io" { "registry-1.docker.io" } else { host };
                (registry.to_string(), rest.to_string())
            }
            Some(_) => ("registry-1.docker.io".to_string(), repo.to_string()),
            None => ("registry-1.docker.io".to_string(), format!("library/{repo}")),
        };
        Some(Self { repo: repo.to_string(), registry, path, tag: tag.to_string() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parts(s: &str) -> (String, String, String, String) {
        let r = ImageRef::parse(s).unwrap();
        (r.repo, r.registry, r.path, r.tag)
    }

    #[test]
    fn reads_every_form_compose_uses() {
        let hub = "registry-1.docker.io".to_string();
        assert_eq!(parts("postgres:16.15-alpine"), ("postgres".into(), hub.clone(), "library/postgres".into(), "16.15-alpine".into()));
        assert_eq!(parts("binwiederhier/ntfy:v2.28.0"), ("binwiederhier/ntfy".into(), hub.clone(), "binwiederhier/ntfy".into(), "v2.28.0".into()));
        assert_eq!(
            parts("ghcr.io/immich-app/immich-server:v3.2.2"),
            ("ghcr.io/immich-app/immich-server".into(), "ghcr.io".into(), "immich-app/immich-server".into(), "v3.2.2".into())
        );
        assert_eq!(parts("docker.io/library/redis:7.4.11-alpine").1, hub);
        assert_eq!(parts("localhost:5000/app:1.2").1, "localhost:5000");
    }

    #[test]
    fn skips_what_it_cannot_compare() {
        assert_eq!(ImageRef::parse("postgres"), None);
        assert_eq!(ImageRef::parse("localhost:5000/app"), None);
        assert_eq!(ImageRef::parse("postgres@sha256:abc"), None);
        assert_eq!(ImageRef::parse("sha256:0123abcd"), None);
        assert_eq!(ImageRef::parse(""), None);
    }
}
