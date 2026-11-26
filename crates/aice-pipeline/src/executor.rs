use aice_governance::{
    AdminGoverned, AdminOp, FindOp, Governed, PipelineRequest, ReadOp, SearchOp, WriteOp,
};

use crate::admin_flow;
use crate::find_flow;
use crate::read_flow;
use crate::search_flow;
use crate::state::{Executed, PipelineError, PipelineResult};
use crate::write_flow;

/// 5. Single unbypassable pipeline entrypoint.
pub trait PipelineExecutor: Send + Sync {
    fn execute_read(
        &self,
        req: PipelineRequest<Governed, ReadOp>,
    ) -> Result<PipelineResult<Executed>, PipelineError>;

    fn execute_write(
        &self,
        req: PipelineRequest<Governed, WriteOp>,
    ) -> Result<PipelineResult<Executed>, PipelineError>;

    fn execute_find(
        &self,
        req: PipelineRequest<Governed, FindOp>,
    ) -> Result<PipelineResult<Executed>, PipelineError>;

    fn execute_search(
        &self,
        req: PipelineRequest<Governed, SearchOp>,
    ) -> Result<PipelineResult<Executed>, PipelineError>;

    fn execute_admin(
        &self,
        req: PipelineRequest<AdminGoverned, AdminOp>,
    ) -> Result<PipelineResult<Executed>, PipelineError>;
}

#[derive(Debug, Default)]
pub struct DefaultPipelineExecutor;

impl PipelineExecutor for DefaultPipelineExecutor {
    fn execute_read(
        &self,
        req: PipelineRequest<Governed, ReadOp>,
    ) -> Result<PipelineResult<Executed>, PipelineError> {
        read_flow::run(req.state(), req.op())
    }

    fn execute_write(
        &self,
        req: PipelineRequest<Governed, WriteOp>,
    ) -> Result<PipelineResult<Executed>, PipelineError> {
        write_flow::run(req.state(), req.op())
    }

    fn execute_find(
        &self,
        req: PipelineRequest<Governed, FindOp>,
    ) -> Result<PipelineResult<Executed>, PipelineError> {
        find_flow::run(req.state(), req.op())
    }

    fn execute_search(
        &self,
        req: PipelineRequest<Governed, SearchOp>,
    ) -> Result<PipelineResult<Executed>, PipelineError> {
        search_flow::run(req.state(), req.op())
    }

    fn execute_admin(
        &self,
        req: PipelineRequest<AdminGoverned, AdminOp>,
    ) -> Result<PipelineResult<Executed>, PipelineError> {
        admin_flow::run(req.state(), req.op())
    }
}
