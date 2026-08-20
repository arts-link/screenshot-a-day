declare module "ssh2-sftp-client" {
  export default class SftpClient {
    connect(config: Record<string, unknown>): Promise<unknown>;
    end(): Promise<void>;
    list(path: string): Promise<Array<{ name: string; type: string }>>;
    realPath(path: string): Promise<string>;
    exists(path: string): Promise<boolean | string>;
    get(path: string): Promise<Buffer>;
    put(source: Buffer | string, path: string): Promise<string>;
    mkdir(path: string, recursive?: boolean): Promise<string>;
    rename(from: string, to: string): Promise<string>;
    posixRename(from: string, to: string): Promise<string>;
    delete(path: string): Promise<string>;
  }
}
