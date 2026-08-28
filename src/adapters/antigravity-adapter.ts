import { Orchestrator, OrchestrationOptions } from '../core/orchestrator.js';
import { Doctor } from '../core/doctor.js';
import { StatusDashboard } from '../core/status.js';
import { Observer } from '../core/observer.js';
import { Reconciler } from '../core/reconciler.js';
import { RecoveryEngine } from '../core/recovery.js';

export class AntigravityAdapter {
  private orchestrator: Orchestrator;
  private doctor: Doctor;
  private statusDashboard: StatusDashboard;
  private observer: Observer;
  private reconciler: Reconciler;
  private recoveryEngine: RecoveryEngine;

  constructor(projectRoot: string = process.cwd()) {
    this.orchestrator = new Orchestrator(projectRoot);
    this.doctor = new Doctor(projectRoot);
    this.statusDashboard = new StatusDashboard(projectRoot);
    this.observer = new Observer(projectRoot);
    this.reconciler = new Reconciler(projectRoot);
    this.recoveryEngine = new RecoveryEngine(projectRoot);
  }

  public async handleRun(options?: OrchestrationOptions) {
    return this.orchestrator.runCycle(options);
  }

  public handleStatus() {
    return this.statusDashboard.render();
  }

  public handleDoctor() {
    const report = this.doctor.runDiagnostics();
    return this.doctor.formatReport(report);
  }

  public handleObserve(runId: string = 'RUN-OBSERVE') {
    return this.observer.observe(runId);
  }

  public handleReconcile(runId: string = 'RUN-RECONCILE') {
    const obs = this.observer.observe(runId);
    return this.reconciler.reconcile(runId, obs);
  }

  public handleResume() {
    return this.recoveryEngine.planRecovery();
  }
}
