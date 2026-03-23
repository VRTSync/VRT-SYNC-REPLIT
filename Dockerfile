# 1. Use a lightweight Node image
FROM node:20-slim

# 2. Set the working directory
WORKDIR /app

# 3. Copy package files first (helps with faster builds)
COPY package*.json ./

# 4. Install dependencies
# Using 'npm install' ensures tsx/typescript are available at runtime
RUN npm install

# 5. Copy the entire project
COPY . .

# 6. Expose the port the Express server listens on
EXPOSE 3000

# 7. Start the server using tsx
CMD ["npx", "tsx", "server/index.ts"]
