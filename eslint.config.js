// @ts-check
import tseslint from 'typescript-eslint';

const MATH_MSG = 'Engine-dependent result: use src/sim/math.ts.';
const BANNED_MATH = [
  'random', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'pow', 'exp', 'log', 'log2',
  'log10', 'sinh', 'cosh', 'tanh', 'hypot', 'cbrt', 'expm1', 'log1p',
];
const BANNED_GLOBALS = [
  'window', 'document', 'navigator', 'performance', 'Date', 'localStorage',
  'requestAnimationFrame', 'setTimeout', 'setInterval',
];
const SIM_MSG = 'src/sim is pure: no three.js, DOM, render, ui, audio, app or input imports.';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'artifacts/**', 'coverage/**', '.claude/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-nocheck': true, 'ts-expect-error': 'allow-with-description' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['src/sim/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'three', message: SIM_MSG }],
          patterns: [
            { group: ['three/*'], message: SIM_MSG },
            { regex: '^(\\.\\./)+(render|ui|audio|app|input)(/|$)', message: SIM_MSG },
            { regex: '(^|/)src/(render|ui|audio|app|input)(/|$)', message: SIM_MSG },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...BANNED_GLOBALS.map((name) => ({ name, message: 'src/sim is pure: no DOM, clocks or timers.' })),
      ],
      'no-restricted-properties': [
        'error',
        ...BANNED_MATH.map((property) => ({ object: 'Math', property, message: MATH_MSG })),
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "BinaryExpression[operator='**']", message: `The ** operator is engine-dependent. ${MATH_MSG}` },
        { selector: "AssignmentExpression[operator='**=']", message: `The **= operator is engine-dependent. ${MATH_MSG}` },
      ],
    },
  },
);
