use bollard::{
    Docker,
    container::ListContainersOptions,
    volume::ListVolumesOptions,
    secret::{ ContainerSummary, MountPointTypeEnum, VolumeScopeEnum },
};
use cosmos_common::types::{ VolumeInfo, VolumesResponse };
use std::collections::HashMap;

pub async fn get_volumes() -> VolumesResponse {
    let docker = match Docker::connect_with_socket_defaults() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("Failed to connect to Docker socket: {e}");
            return VolumesResponse { volumes: vec![] };
        }
    };

    // Volume metadata and container mounts are separate Docker API calls,
    // so fetch them concurrently rather than one after the other.
    let (volumes_result, containers_result) = tokio::join!(
        docker.list_volumes(Some(ListVolumesOptions::<String>::default())),
        docker.list_containers(Some(ListContainersOptions::<String> {
            all: true,
            ..Default::default()
        }))
    );

    let containers = match containers_result {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Failed to list containers for volume usage lookup: {e}");
            vec![]
        }
    };
    let in_use_by = build_volume_usage_map(containers);

    let volumes = match volumes_result {
        Ok(resp) => resp.volumes.unwrap_or_default(),
        Err(e) => {
            eprintln!("Failed to list volumes: {e}");
            vec![]
        }
    };

    let volumes = volumes
        .into_iter()
        .map(|v| {
            let compose_project = v.labels.get("com.docker.compose.project").cloned();
            let cosmos_service = v.labels.get("cosmos.service").cloned();

            let scope = v.scope.and_then(|s| match s {
                VolumeScopeEnum::LOCAL => Some("local".to_string()),
                VolumeScopeEnum::GLOBAL => Some("global".to_string()),
                VolumeScopeEnum::EMPTY => None,
            });

            let in_use_by = in_use_by.get(&v.name).cloned().unwrap_or_default();

            VolumeInfo {
                name: v.name,
                driver: v.driver,
                mountpoint: v.mountpoint,
                created_at: v.created_at,
                scope,
                compose_project,
                cosmos_service,
                in_use_by,
            }
        })
        .collect();

    VolumesResponse { volumes }
}

// bollard's container summaries already include each container's mount
// points, so this is just a reshape — no extra Docker calls needed.
fn build_volume_usage_map(containers: Vec<ContainerSummary>) -> HashMap<String, Vec<String>> {
    let mut map: HashMap<String, Vec<String>> = HashMap::new();

    for c in containers {
        let name = c.names
            .unwrap_or_default()
            .first()
            .cloned()
            .unwrap_or_default()
            .trim_start_matches('/')
            .to_string();

        for mount in c.mounts.unwrap_or_default() {
            if mount.typ != Some(MountPointTypeEnum::VOLUME) {
                continue;
            }
            if let Some(volume_name) = mount.name {
                let entry = map.entry(volume_name).or_default();
                if !entry.contains(&name) {
                    entry.push(name.clone());
                }
            }
        }
    }

    map
}