use std::process;

fn main() {
    let args: Vec<String> = std::env::args_os()
        .skip(1)
        .map(|s| s.to_string_lossy().into_owned())
        .collect();

    let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let exit_code = aice_cli::run_cli(&args, &cwd);
    process::exit(exit_code);
}
