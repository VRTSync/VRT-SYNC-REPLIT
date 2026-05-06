// pnpm stores packages under node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>.
// Jest's transformIgnorePatterns regex is tested against the full file path.
// Without including '.pnpm' in the allowlist, the regex matches at the first
// "node_modules/.pnpm" segment (because ".pnpm" isn't in the allowlist) and
// marks the file as "do not transform" before reaching the actual package name.
// Adding '.pnpm' to the negative lookahead makes Jest skip that segment and
// then find the real package name in the second "node_modules/<pkg>" segment.

const TRANSFORM_ALLOW = [
  '\\.pnpm',
  '(jest-)?react-native',
  '@react-native(-community)?',
  'expo(nent)?',
  '@expo(nent)?/.*',
  '@expo-google-fonts/.*',
  'react-navigation',
  '@react-navigation/.*',
  '@sentry/react-native',
  'native-base',
  'react-native-svg',
  'react-native-reanimated',
].join('|');

module.exports = {
  preset: 'jest-expo',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testMatch: ['<rootDir>/__tests__/**/*.test.{ts,tsx}'],
  transformIgnorePatterns: [
    `node_modules/(?!(${TRANSFORM_ALLOW}))`,
  ],
};
