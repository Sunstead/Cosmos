use bollard::{ container::ListContainersOptions, container::StatsOptions, Docker };
use cosmos_common::types::{ ContainerInfo, ContainersResponse };
use futures_util::StreamExt;

pub async fn get_containers() -> ContainersResponse {
    let docker = match Docker::connect_with_socket_defaults() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("Failed to connect to Docker socket: {e}");
            return ContainersResponse { containers: vec![] };
        }
    };

    let options = ListContainersOptions::<String> {
        all: false, // running only
        ..Default::default()
    };

    let container_list = match docker.list_containers(Some(options)).await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Failed to list containers: {e}");
            return ContainersResponse { containers: vec![] };
        }
    };

    // Collect stats concurrently across all containers
    let futures: Vec<_> = container_list
        .into_iter()
        .map(|c| {
            let docker = docker.clone();
            async move {
                let id = c.id.unwrap_or_default();
                let name = c.names
                    .unwrap_or_default()
                    .first()
                    .cloned()
                    .unwrap_or_default()
                    .trim_start_matches('/')
                    .to_string();
                let image = c.image.unwrap_or_default();
                let status = c.status.unwrap_or_default();
                let started_at = c.created.map(|t| {
                    chrono::DateTime
                        ::from_timestamp(t, 0)
                        .map(|dt| dt.to_rfc3339())
                        .unwrap_or_default()
                });
                let labels = c.labels.unwrap_or_default();
                let compose_project = labels.get("com.docker.compose.project").cloned();
                let cosmos_service = labels.get("cosmos.service").cloned();

                let (cpu_pct, mem_mb) = get_container_stats(&docker, &id).await;

                ContainerInfo {
                    id,
                    name,
                    image,
                    status,
                    started_at,
                    compose_project,
                    cosmos_service,
                    cpu_pct,
                    mem_mb,
                }
            }
        })
        .collect();

    let containers = futures_util::future::join_all(futures).await;
    ContainersResponse { containers }
}

async fn get_container_stats(docker: &Docker, id: &str) -> (f64, f64) {
    let options = StatsOptions {
        stream: false,
        one_shot: true,
    };
    let mut stream = docker.stats(id, Some(options));

    match stream.next().await {
        Some(Ok(stats)) => {
            let cpu_pct = {
                let cpu_delta = stats.cpu_stats.cpu_usage.total_usage.saturating_sub(
                    stats.precpu_stats.cpu_usage.total_usage
                );
                let system_delta = stats.cpu_stats.system_cpu_usage
                    .unwrap_or(0)
                    .saturating_sub(stats.precpu_stats.system_cpu_usage.unwrap_or(0));
                let num_cpus = stats.cpu_stats.online_cpus.unwrap_or(1) as f64;
                if system_delta > 0 {
                    ((cpu_delta as f64) / (system_delta as f64)) * num_cpus * 100.0
                } else {
                    0.0
                }
            };
            let mem_mb = (stats.memory_stats.usage.unwrap_or(0) as f64) / 1_048_576.0;
            (cpu_pct, mem_mb)
        }
        _ => (0.0, 0.0),
    }
}
