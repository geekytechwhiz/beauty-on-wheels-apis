import {User} from '../entities/User'; export class UserFactory{static createCustomer(p:any){return new User(p.userId,p.email,p.username,p.phoneNumber,'CUSTOMER','ACTIVE');}}
