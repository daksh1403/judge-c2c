# Trusted base pinned independently of participant repositories.
FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
# Frozen package catalogue. This build occurs before evaluation, never in a submission VM.
RUN printf 'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/20261001T000000Z bookworm main\n' > /etc/apt/sources.list \
    && rm -f /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Check-Valid-Until=false update \
    && apt-get install -y --no-install-recommends util-linux \
    && rm -rf /var/lib/apt/lists/* \
    && test -x /usr/bin/prlimit && test -x /usr/bin/setpriv
COPY package.json package-lock.json /opt/judge/
RUN cd /opt/judge && npm ci --ignore-scripts --omit=dev \
    && chmod -R go-w /opt/judge
WORKDIR /work
CMD ["sleep", "infinity"]
