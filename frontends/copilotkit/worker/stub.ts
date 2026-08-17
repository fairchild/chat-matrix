// Stands in for `express` and `cors` in the Worker bundle — see worker/index.ts.
const stub: any = () => stub;
stub.Router = () => stub;
export default stub;
