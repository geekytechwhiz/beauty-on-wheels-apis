export class UserName{constructor(public readonly value:string){if(value.length<3)throw new Error('Invalid username');}}
