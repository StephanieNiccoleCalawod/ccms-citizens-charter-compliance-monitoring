import nextVitals from 'eslint-config-next/core-web-vitals';

const config = [
  ...nextVitals,
  {
    ignores: ['.next/**', '.next-qa/**', 'node_modules/**', 'next-env.d.ts', 'tests/e2e/**'],
  },
  {
    rules: {
      // Each service is its own app, so links between services are plain page navigations.
      '@next/next/no-html-link-for-pages': 'off',
      '@next/next/no-location-assign-relative-destination': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // A call to a state setter or helper that was removed (for example setFormError) must fail the lint, not the page.
      'no-undef': 'error',
    },
  },
];

export default config;
