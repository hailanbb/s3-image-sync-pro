declare module "*.wasm" {
  const binary: Uint8Array;
  export default binary;
}
