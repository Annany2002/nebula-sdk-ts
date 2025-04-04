// jest.config.js
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src", "<rootDir>/test"], // Look for tests in src and test dirs
  testMatch: [
    // Pattern for test files
    "**/?(*.)+(spec|test).+(ts|tsx|js)",
  ],
  transform: {
    "^.+\\.(ts|tsx)$": "ts-jest",
  },
  collectCoverage: true, // Enable coverage reporting
  coverageDirectory: "coverage",
  coverageProvider: "v8", // More modern coverage provider
  // setupFilesAfterEnv: ['<rootDir>/test/setup.ts'], // Optional setup file
  clearMocks: true, // Automatically clear mock calls and instances between every test
};
