import { State } from './types';

export class StateManager {
  private state: State = {
    maintenanceMode: false,
    isQuitting: false
  };

  public getMaintenanceModeState(): boolean {
    return this.state.maintenanceMode;
  }

  public setMaintenanceModeState(value: boolean): void {
    this.state.maintenanceMode = value;
  }

  public getIsQuitting(): boolean {
    return this.state.isQuitting;
  }

  public setIsQuitting(value: boolean): void {
    this.state.isQuitting = value;
  }
}

export const stateManager = new StateManager();
export default stateManager;
