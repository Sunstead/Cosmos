use crate::{ api::CachedJson, state::AppState };
use axum::{ extract::State, response::IntoResponse };

pub async fn list(State(state): State<AppState>) -> impl IntoResponse {
    CachedJson(state.volumes_rx.borrow().json.clone())
}
