FROM node:20-alpine

RUN apk add --no-cache openssh-client

COPY scripts/oracle-tunnel-controller.mjs /usr/local/bin/oracle-tunnel-controller.mjs
RUN chmod +x /usr/local/bin/oracle-tunnel-controller.mjs

CMD ["node", "/usr/local/bin/oracle-tunnel-controller.mjs"]
