export interface PasswordHasher{hash(v:string):Promise<string>;compare(p:string,h:string):Promise<boolean>;}
