use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use regex::Regex;
use std::ffi::{CStr, CString};
use std::os::raw::c_char;

type CallbackFn = extern "C" fn(*const c_char);

static mut DOMAINS: Option<HashSet<String>> = None;

lazy_static! {
    static ref URL_REGEX: Regex = Regex::new(r"https?://[^\s]+").unwrap();
}

fn load_domains(file_path: &str) -> Result<HashSet<String>, std::io::Error> {
    let data = std::fs::read_to_string(file_path)?;
    let domains: Vec<String> = serde_json::from_str(&data)?;
    Ok(domains.into_iter().collect())
}

// ? Initialize the domain set, we allow passing a specific file path just so we can let the user configure it in the actual config file
#[no_mangle]
pub extern "C" fn init_domains(file_path: *const c_char) -> bool {
    unsafe {
        let c_str = CStr::from_ptr(file_path);
        println!("Initializing domains {}", c_str.to_string_lossy());
        let path_str = match c_str.to_str() {
            Ok(v) => v,
            Err(_) => {
                println!("Error: Could not convert path to string");
                return false;
            },
        };
        
        match load_domains(path_str) {
            Ok(domains) => {
                DOMAINS = Some(domains);
                true
            }
            Err(e) => {
                println!("Error: Could not load domains from file: {}", e);
                false
            }
        }
    }
}

#[derive(Serialize, Deserialize)]
struct ResponseStruct {
    phishing: bool,
    domain: Option<String>,
}

// ? simple function to check if a message contains a blacklisted / phishing domain
#[no_mangle]
pub extern "C" fn check_message(message: *const c_char, callback: CallbackFn) -> *const c_char {
    let mut result = ResponseStruct { phishing: false, domain: None };

    unsafe {
        let c_str = CStr::from_ptr(message);
        let message_str = match c_str.to_str() {
            Ok(v) => v,
            Err(_) => {
                let response = CString::new(serde_json::to_string(&result).unwrap()).unwrap();
                return response.into_raw();
            }
        };

        #[allow(static_mut_refs)]
        if let Some(domains) = &DOMAINS {
            for url in URL_REGEX.find_iter(message_str) {
                let url_str = url.as_str();
                if domains.iter().any(|domain| url_str.contains(domain)) {
                    result.phishing = true;
                    result.domain = Some(url_str.to_string());
                    break;
                }
            }
        }

        let response_str = serde_json::to_string(&result).unwrap();
        let response_cstr = CString::new(response_str.clone()).unwrap();

        callback(response_cstr.as_ptr());

        CString::new(response_str).unwrap().into_raw()
    }
}

// ? null-terminated string, so we need to free it after we're done with it
#[no_mangle]
pub extern "C" fn free_string(s: *mut c_char) {
    unsafe {
        if s.is_null() {
            return;
        }
        let _ = CString::from_raw(s);
    }
}
