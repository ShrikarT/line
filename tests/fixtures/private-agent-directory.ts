import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve, sep } from 'node:path';

/** A private test fixture, including on hosted Windows runners whose temporary
 * folders carry explicit unrelated ACLs. Production must still reject them. */
export async function createPrivateAgentDirectory(parent: string): Promise<string> {
  const directory = resolve(join(parent,'private'));
  if (!directory.startsWith(resolve(parent)+sep)) throw Error('Fixture directory escaped its temporary parent.');
  await mkdir(directory,{mode:0o700});
  if (process.platform === 'win32') {
    const escaped=directory.replaceAll("'","''");
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; $user=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $system=[System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'); $acl=[System.Security.AccessControl.DirectorySecurity]::new(); $acl.SetOwner($user); $acl.SetAccessRuleProtection($true,$false); foreach($principal in @($user,$system)){ $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($principal,'FullControl','ContainerInherit, ObjectInherit','None','Allow')) }; [System.IO.Directory]::SetAccessControl('${escaped}',$acl)`],{windowsHide:true,stdio:'pipe'});
  }
  return directory;
}
