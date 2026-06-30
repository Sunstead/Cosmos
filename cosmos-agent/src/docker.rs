use bollard::{ Docker, container::{ ListContainersOptions, StatsOptions }, secret::PortTypeEnum };
use cosmos_common::types::{ ContainerInfo, ContainersResponse, PortInfo, PortType };
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
        all: true,
        ..Default::default()
    };

    let container_list = match docker.list_containers(Some(options)).await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Failed to list containers: {e}");
            return ContainersResponse { containers: vec![] };
        }
    };

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
                let state = c.state.unwrap_or_default();
                let labels = c.labels.unwrap_or_default();

                let compose_project = labels.get("com.docker.compose.project").cloned();
                let cosmos_service = labels.get("cosmos.service").cloned();
                let cosmos_service_description = labels.get("cosmos.service.description").cloned();
                let cosmos_service_url = labels.get("cosmos.service.url").cloned();

                let ports: Vec<PortInfo> = c.ports
                    .unwrap_or_default()
                    .into_iter()
                    .map(|p| PortInfo {
                        ip: p.ip,
                        private_port: p.private_port,
                        public_port: p.public_port,
                        port_type: p.typ.and_then(|t| {
                            match t {
                                PortTypeEnum::TCP => Some(PortType::Tcp),
                                PortTypeEnum::UDP => Some(PortType::Udp),
                                PortTypeEnum::SCTP => Some(PortType::Sctp),
                                PortTypeEnum::EMPTY => None,
                            }
                        }),
                    })
                    .collect();

                let (cpu_pct, mem_mb, started_at) = get_container_stats_and_info(
                    &docker,
                    &id
                ).await;

                ContainerInfo {
                    id,
                    name,
                    image,
                    status,
                    state,
                    ports,
                    started_at,
                    compose_project,
                    cosmos_service,
                    cosmos_service_description,
                    cosmos_service_url,
                    cpu_pct,
                    mem_mb,
                }
            }
        })
        .collect();

    let containers = futures_util::future::join_all(futures).await;
    ContainersResponse { containers }
}

async fn get_container_stats_and_info(docker: &Docker, id: &str) -> (f64, f64, Option<String>) {
    let (stats_result, inspect_result) = tokio::join!(
        async {
            let options = StatsOptions { stream: false, one_shot: true };
            let mut stream = docker.stats(id, Some(options));
            stream.next().await
        },
        docker.inspect_container(id, None)
    );

    let (cpu_pct, mem_mb) = match stats_result {
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
    };

    let started_at = inspect_result
        .ok()
        .and_then(|i| i.state)
        .and_then(|s| s.started_at);

    (cpu_pct, mem_mb, started_at)
}
