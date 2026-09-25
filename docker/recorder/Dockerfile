# The image stage 3 records in: Node, Puppeteer with the Chrome it was released
# against, and ffmpeg (which page.screencast() shells out to).
#
# The app builds this on first use and rebuilds it whenever anything in this
# directory changes (it labels the image with a hash of the directory).
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates ffmpeg fonts-liberation fonts-noto-color-emoji fonts-noto-cjk \
 && rm -rf /var/lib/apt/lists/*

# Outside /root so the container can run as the host user (keeping the files it
# writes to /output owned by them) and still find the browser.
ENV PUPPETEER_CACHE_DIR=/opt/puppeteer

WORKDIR /app
RUN echo '{"name":"recorder","private":true}' > package.json \
 && npm install --no-audit --no-fund puppeteer@24 \
 && apt-get update \
 && npx puppeteer browsers install chrome --install-deps \
 && rm -rf /var/lib/apt/lists/* \
 && chmod -R a+rX /opt/puppeteer /app

COPY run.sh /usr/local/bin/run-demo
RUN chmod 755 /usr/local/bin/run-demo

# Chrome wants a writable home for its profile; the host uid has none here.
ENV HOME=/tmp
ENTRYPOINT ["run-demo"]
