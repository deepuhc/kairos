/// <reference types="vite/client" />

declare const __KAIROS_VERSION__: string;

declare module '*.md?raw' {
  const content: string;
  export default content;
}

declare module '*.css?inline' {
  const content: string;
  export default content;
}
