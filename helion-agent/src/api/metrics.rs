use crate::{ error::AgentError, sample::host::unix_now, state::AppState };
use axum::{ extract::{ Query, State }, Json };
use cosmos_common::types::{ MetricSeries, MetricStep };
use serde::Deserialize;

#[derive(Deserialize)]
pub struct RangeQuery {
    /// Unix seconds. Defaults to one hour ago.
    from: Option<i64>,
    /// Unix seconds. Defaults to now.
    to: Option<i64>,
    #[serde(default = "default_step")]
    step: MetricStep,
    #[serde(default = "default_max_points")]
    max_points: usize,
}

fn default_step() -> MetricStep {
    MetricStep::Auto
}
fn default_max_points() -> usize {
    1000
}

pub async fn range(
    State(state): State<AppState>,
    Query(q): Query<RangeQuery>
) -> Result<Json<MetricSeries>, AgentError> {
    let history = state.history.clone().ok_or(AgentError::NotEnabled("metrics history"))?;

    let to = q.to.unwrap_or_else(unix_now);
    let from = q.from.unwrap_or(to - 3_600);

    // rusqlite is blocking and `Connection` is !Sync, so the query runs off
    // the async runtime rather than holding a worker for the duration.
    tokio::task
        ::spawn_blocking(move || history.query(from, to, q.step, q.max_points)).await
        .map_err(AgentError::internal)?
        .map(Json)
}
