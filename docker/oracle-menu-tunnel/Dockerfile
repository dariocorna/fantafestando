FROM alpine:3.20

RUN apk add --no-cache bash openssh-client

COPY scripts/oracle-menu-reverse-tunnel.sh /usr/local/bin/oracle-menu-reverse-tunnel.sh
RUN chmod +x /usr/local/bin/oracle-menu-reverse-tunnel.sh

CMD ["/usr/local/bin/oracle-menu-reverse-tunnel.sh"]
