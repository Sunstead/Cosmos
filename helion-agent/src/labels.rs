//! Docker labels. Deployments before the rename (0.13 and older) say
//! `cosmos.service` and `cosmos.update.*`; everything reads `helion.*`, and
//! the old names are accepted here, once, at the edge. The new name wins when a
//! container carries both.

use std::{ collections::{ BTreeMap, HashMap, HashSet }, sync::Mutex };

const LEGACY: &str = "cosmos.";
const CURRENT: &str = "helion.";

/// `helion.<suffix>`, else `cosmos.<suffix>`. Unset and empty are the same.
pub fn label(labels: &HashMap<String, String>, suffix: &str) -> Option<String> {
    if let Some(v) = labels.get(&format!("{CURRENT}{suffix}")) {
        return Some(v.clone());
    }
    let old = format!("{LEGACY}{suffix}");
    let v = labels.get(&old)?;
    deprecated(&old, &format!("{CURRENT}{suffix}"));
    Some(v.clone())
}

/// Every `update` / `update.*` label, keyed by its `helion.` name whichever
/// namespace it was written in.
pub fn update_labels(labels: &HashMap<String, String>) -> BTreeMap<String, String> {
    let is_update = |rest: &str| rest == "update" || rest.starts_with("update.");
    let mut out = BTreeMap::new();
    for (k, v) in labels {
        if let Some(rest) = k.strip_prefix(LEGACY).filter(|r| is_update(r)) {
            let new = format!("{CURRENT}{rest}");
            if !labels.contains_key(&new) {
                deprecated(k, &new);
                out.insert(new, v.clone());
            }
        }
    }
    for (k, v) in labels {
        if k.strip_prefix(CURRENT).is_some_and(is_update) {
            out.insert(k.clone(), v.clone());
        }
    }
    out
}

/// Samplers read labels every few seconds, so each old name is reported once
/// per process rather than once per container per tick.
fn deprecated(old: &str, new: &str) {
    static SEEN: Mutex<Option<HashSet<String>>> = Mutex::new(None);
    let first = SEEN.lock().is_ok_and(|mut s| s.get_or_insert_with(HashSet::new).insert(old.to_string()));
    if first {
        tracing::warn!("the container label {old} is deprecated; rename it to {new}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labels(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn reads_either_namespace_and_prefers_the_new_one() {
        assert_eq!(label(&labels(&[("helion.service", "gitea")]), "service").as_deref(), Some("gitea"));
        assert_eq!(label(&labels(&[("cosmos.service", "gitea")]), "service").as_deref(), Some("gitea"));
        let both = labels(&[("cosmos.service.url", "old.example"), ("helion.service.url", "new.example")]);
        assert_eq!(label(&both, "service.url").as_deref(), Some("new.example"));
        assert_eq!(label(&labels(&[("com.docker.compose.service", "x")]), "service"), None);
    }

    #[test]
    fn update_labels_are_renamed_to_the_current_namespace() {
        let old = update_labels(
            &labels(
                &[
                    ("cosmos.update", "off"),
                    ("cosmos.update.hold", "major"),
                    ("cosmos.service", "gitea"),
                    ("cosmos.updated-at", "never"),
                ]
            )
        );
        assert_eq!(
            old.into_iter().collect::<Vec<_>>(),
            [
                ("helion.update".to_string(), "off".to_string()),
                ("helion.update.hold".to_string(), "major".to_string()),
            ]
        );

        let both = update_labels(&labels(&[("cosmos.update.hold", "minor"), ("helion.update.hold", "major")]));
        assert_eq!(both["helion.update.hold"], "major");
        assert_eq!(both.len(), 1);

        let new = update_labels(&labels(&[("helion.update.group", "immich")]));
        assert_eq!(new["helion.update.group"], "immich");
    }
}
