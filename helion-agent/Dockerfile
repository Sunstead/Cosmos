# syntax=docker/dockerfile:1.7
#
# The agent plus the web UI it serves. Build from the REPOSITORY ROOT:
#   docker build -f helion-agent/Dockerfile -t helion-agent .

# Stages run in parallel, so each gets its own cache ids: cargo can't safely
# unpack into one registry from two builds at once.

# TypeScript bindings come from ts-rs, which exports them during tests.
FROM rust:1-bookworm AS bindings
WORKDIR /src
COPY . .
RUN --mount=type=cache,id=helion-bindings-registry,sharing=locked,target=/usr/local/cargo/registry \
    --mount=type=cache,id=helion-bindings-target,sharing=locked,target=/src/target \
    cargo test --locked -p helion-common --quiet

# The web build is platform independent, so it runs natively on the builder.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS web
WORKDIR /src/app
COPY app/package.json app/package-lock.json ./
RUN --mount=type=cache,id=helion-npm,sharing=locked,target=/root/.npm npm ci --no-audit --no-fund
COPY app/ ./
COPY --from=bindings /src/app/src/generated ./src/generated
RUN npm run build

FROM rust:1-bookworm AS build
WORKDIR /src
COPY . .
RUN --mount=type=cache,id=helion-agent-registry,sharing=locked,target=/usr/local/cargo/registry \
    --mount=type=cache,id=helion-agent-target,sharing=locked,target=/src/target \
    cargo build --locked --profile release-agent -p helion-agent \
 && cp /src/target/release-agent/helion-agent /helion-agent \
 && mkdir -p /data

# distroless/cc: glibc and libgcc, no shell and no package manager. No CA
# certificates are needed (the agent only talks to a unix socket and SQLite,
# which is compiled in via rusqlite's `bundled` feature).
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /helion-agent /usr/local/bin/helion-agent
# The history volume mounts here. Docker seeds a new named volume with this
# directory's ownership, so without it the volume is root-owned and the
# non-root agent can't create its database.
COPY --from=build --chown=65532:65532 /data /var/lib/helion-agent
COPY --from=web /src/app/dist /usr/share/helion-agent/web
ENV HELION_AGENT_WEB_DIR=/usr/share/helion-agent/web
USER 65532:65532
EXPOSE 7700
ENTRYPOINT ["/usr/local/bin/helion-agent"]
