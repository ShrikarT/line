export type ArtifactFingerprint = { size: number; sha256: string };
export type ReleaseInputs = {
  source: ArtifactFingerprint & { path: string };
  compilerWrapper: ArtifactFingerprint & { path: string };
  compact: { compiler: string; language: string; runtime: string; ledger: string };
  runtimeDependency: string;
};
export type ValidatedRelease = {
  artifactDir: string;
  compilerInfo: Record<string, unknown>;
  release: Record<string, unknown> | null;
  inputs: ReleaseInputs;
  files: Record<string, ArtifactFingerprint>;
};
export type ContractProfile = "canonical" | "test-settlement" | "organization";
export function resolveContractRelease(options?: { projectRoot?: string; profile?: ContractProfile }): string;
export function validateContractArtifacts(options: { artifactDir: string; projectRoot?: string; requireKeys?: boolean; requireRelease?: boolean; profile?: ContractProfile }): ValidatedRelease;
