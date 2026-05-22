FROM rust:1.95.0-bookworm

# System dependencies for Tauri
RUN apt-get update && apt-get install -y --no-install-recommends \
    libwebkit2gtk-4.1-dev \
    libappindicator3-dev \
    librsvg2-dev \
    patchelf \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    && rm -rf /var/lib/apt/lists/*

# Node.js (pinned)
ENV NODE_VERSION=22.22.3
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs=${NODE_VERSION}-1nodesource1 \
    || (curl -fsSL https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz \
        | tar -xJ --strip-components=1 -C /usr/local)

# pnpm (pinned)
ENV PNPM_VERSION=10.11.0
RUN npm install -g pnpm@${PNPM_VERSION}

# Tauri CLI (pinned via Cargo)
RUN cargo install tauri-cli@2.5.0

WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm tauri build
