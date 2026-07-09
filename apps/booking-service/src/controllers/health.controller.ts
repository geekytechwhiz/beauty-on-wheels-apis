export class HealthController{async handleHealth(){return {status:'UP'};}}
export const getHealthController=()=>new HealthController();