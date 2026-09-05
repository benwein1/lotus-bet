// NativeWind compiles `global.css` through Metro; TypeScript only needs to
// know the side-effect import in app/_layout.tsx is legal.
declare module '*.css';
