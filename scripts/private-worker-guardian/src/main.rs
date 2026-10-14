//! Own only the already-created financial worker's process tree. No keys,
//! private preimages, network or wallet data are accepted by this program.
use std::{env, io::{self, Read, Write}, process::ExitCode, sync::mpsc, thread, time::{Duration, Instant}};

fn owner_channel() -> mpsc::Receiver<()> {
    let (tx,rx)=mpsc::channel();
    thread::spawn(move || { let mut byte=[0u8;1];let _=io::stdin().read(&mut byte);let _=tx.send(()); });
    rx
}
#[cfg(windows)]
fn guard(pid:u32) -> Result<(), &'static str> {
    use windows_sys::Win32::{Foundation::{CloseHandle,WAIT_OBJECT_0,WAIT_FAILED},System::{JobObjects::*,Threading::*}};
    unsafe {
        let job=CreateJobObjectW(std::ptr::null(),std::ptr::null());if job.is_null(){return Err("job_create");}
        let mut limits=JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(job,JobObjectExtendedLimitInformation,&limits as *const _ as *const _,std::mem::size_of_val(&limits) as u32)==0{CloseHandle(job);return Err("job_limits");}
        let worker=OpenProcess(PROCESS_SET_QUOTA|PROCESS_TERMINATE|PROCESS_SYNCHRONIZE,0,pid);
        if worker.is_null(){CloseHandle(job);return Err("worker_open");}
        if AssignProcessToJobObject(job,worker)==0{CloseHandle(worker);CloseHandle(job);return Err("job_assign");}
        let owner=owner_channel();println!("GUARD_READY:windows-job");let _=io::stdout().flush();
        loop {let waited=WaitForSingleObject(worker,100);if waited==WAIT_OBJECT_0||waited==WAIT_FAILED||owner.try_recv().is_ok(){break;}}
        // Keep the unique job handle until all members have terminated. Closing
        // it also kills members if this guardian itself is forcefully stopped.
        let terminated=TerminateJobObject(job,23)!=0;let start=Instant::now();let mut empty=false;
        while terminated&&start.elapsed()<Duration::from_secs(10){
            let mut info=JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
            if QueryInformationJobObject(job,JobObjectBasicAccountingInformation,&mut info as *mut _ as *mut _,std::mem::size_of_val(&info) as u32,std::ptr::null_mut())!=0&&info.ActiveProcesses==0{empty=true;break;}
            thread::sleep(Duration::from_millis(25));
        }
        CloseHandle(worker);CloseHandle(job);if !empty{return Err("termination_uncertain");}
        println!("GUARD_STOPPED:windows-job");Ok(())
    }
}
#[cfg(unix)]
fn guard(pid:u32) -> Result<(), &'static str> {
    let p=pid as i32;if unsafe{libc::getpgid(p)}!=p{return Err("worker_not_isolated_group");}
    let owner=owner_channel();println!("GUARD_READY:posix-group");let _=io::stdout().flush();
    loop {if owner.try_recv().is_ok()||unsafe{libc::kill(p,0)}!=0{break;}thread::sleep(Duration::from_millis(100));}
    // Members are trusted not to leave their isolated group. Windows provides
    // stronger kernel containment; POSIX simultaneous guardian+worker SIGKILL
    // is not a universal containment guarantee.
    unsafe{libc::kill(-p,libc::SIGKILL);}
    println!("GUARD_STOPPED:posix-group");Ok(())
}
fn main()->ExitCode{
    let args:Vec<String>=env::args().skip(1).collect();let pid=args.first().and_then(|s|s.parse::<u32>().ok());
    if args.len()!=1||pid.is_none_or(|p|p<=1||p==std::process::id()){eprintln!("GUARD_REJECTED:usage");return ExitCode::FAILURE;}
    match guard(pid.unwrap()){Ok(())=>ExitCode::SUCCESS,Err(category)=>{eprintln!("GUARD_REJECTED:{category}");ExitCode::FAILURE}}
}
