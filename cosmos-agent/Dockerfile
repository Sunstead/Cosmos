# syntax=docker/dockerfile:1.7
#
# Build from the REPOSITORY ROOT, not this directory:
#   docker build -f cosmos-agent/Dockerfile -t cosmos-agent:0.2.0 .

FROM rust:1-bookworm AS build
WORKDIR /src

# BuildKit cache mounts instead of cargo-chef: one less tool, same effect of
# not recompiling every dependency on each source change.
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --locked --profile release-agent -p cosmos-agent \
 && cp /src/target/release-agent/cosmos-agent /cosmos-agent

# distroless/cc: glibc and libgcc, no shell and no package manager, so there is
# nothing to exploit into. No CA certificates are needed — the agent talks only
# to a unix socket and a local SQLite file — and rusqlite's `bundled` feature
# compiles SQLite into the binary, so there is no libsqlite3 to ship either.
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /cosmos-agent /usr/local/bin/cosmos-agent
USER 65532:65532
EXPOSE 7700
ENTRYPOINT ["/usr/local/bin/cosmos-agent"]
