# Use the official Node.js image from the Docker Hub
FROM node:14

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json files to the working directory
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code to the working directory
COPY . .

# Ensure node modules are executable
RUN chmod -R 755 /app

# Expose the port that the app runs on
EXPOSE 5000

# Start the server using Nodemon
CMD ["npm", "start"]
