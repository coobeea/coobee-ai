import { State } from './types'

export class StateManager {
  private state: State = {
    maintenanceMode: false
  }

  public getMaintenanceModeState(): boolean {
    return this.state.maintenanceMode
  }

  public setMaintenanceModeState(value: boolean): void {
    this.state.maintenanceMode = value
  }
}

export const stateManager = new StateManager()
export default stateManager
