FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

COPY .next/standalone ./
COPY .next/static ./.next/static
COPY public ./public

# Runtime writes optimized image cache and custom uploaded menu headers.
RUN mkdir -p /app/.next/cache /app/public/uploads/menu-headers \
    && chown -R nextjs:nodejs /app/.next /app/public/uploads

EXPOSE 3000
USER nextjs

CMD ["node", "server.js"]
