import { translate as $l } from "@padloc/locale/src/translate";
import { RetrieveMFATokenResponse } from "@padloc/core/src/api";
import { ErrorCode } from "@padloc/core/src/error";
import { MFAPurpose } from "@padloc/core/src/mfa";
import { app, router } from "../globals";
import { element, html, css, property, query } from "./base";
import { StartForm } from "./start-form";
import { Input } from "./input";
import { PasswordInput } from "./password-input";
import { LoadingButton } from "./loading-button";
import { alert, confirm, prompt } from "../lib/dialog";
import "./logo";

@element("pl-login")
export class Login extends StartForm {
    @property()
    private _errorMessage: string;

    @query("#emailInput")
    private _emailInput: Input;
    @query("#passwordInput")
    private _passwordInput: PasswordInput;
    @query("#loginButton")
    private _loginButton: LoadingButton;

    private _failedCount = 0;

    async reset() {
        await this.updateComplete;
        this._emailInput.value = router.params.email || "";
        this._passwordInput.value = "";
        this._loginButton.stop();
        this._failedCount = 0;
        super.reset();
        if (router.params.verifying) {
            this._verifyEmail();
        }
    }

    static styles = [
        ...StartForm.styles,
        css`
            .hint {
                font-size: var(--font-size-tiny);
                box-sizing: border-box;
                transition: max-height 0.3s;
                max-height: 100px;
                margin: 40px 0 -20px 0;
            }

            button.signup {
                background: none;
                border: none;
                height: auto;
                line-height: normal;
                font-weight: bold;
                height: var(--row-height);
            }
        `
    ];

    render() {
        return html`
            <div flex></div>

            <form>
                <pl-logo class="animate"></pl-logo>

                <pl-input
                    id="emailInput"
                    type="email"
                    required
                    select-on-focus
                    .label=${$l("Email Address")}
                    class="animate tap"
                    @enter=${() => this._submit()}
                >
                </pl-input>

                <pl-password-input
                    id="passwordInput"
                    required
                    select-on-focus
                    .label=${$l("Master Password")}
                    class="animate tap"
                    @enter=${() => this._submit()}
                >
                </pl-password-input>

                <pl-loading-button id="loginButton" class="tap animate" @click=${() => this._submit()}>
                    ${$l("Login")}
                </pl-loading-button>

                ${this._errorMessage
                    ? html`
                          <div class="error note animate">${this._errorMessage}</div>
                      `
                    : ""}

                <div class="hint animate">
                    ${$l("New to Padloc?")}
                </div>

                <button type="button" class="tap signup animate" @click=${() => router.go("signup")}>
                    ${$l("Sign Up Now")}
                </button>
            </form>

            <div flex></div>
        `;
    }

    private async _verifyEmail() {
        router.params = { ...router.params, email: this._emailInput.value, verifying: "1" };

        const res: RetrieveMFATokenResponse | null = await prompt(
            $l("Please enter the confirmation code sent to your email address to proceed!"),
            {
                title: $l("One Last Step!"),
                placeholder: $l("Enter Verification Code"),
                confirmLabel: $l("Submit"),
                type: "number",
                pattern: "[0-9]*",
                validate: async (code: string) => {
                    try {
                        return app.retrieveMFAToken(this._emailInput.value, code, MFAPurpose.Login);
                    } catch (e) {
                        if (e.code === ErrorCode.MFA_TRIES_EXCEEDED) {
                            alert($l("Maximum number of tries exceeded! Please resubmit and try again!"), {
                                type: "warning"
                            });
                            return null;
                        }
                        throw e.message ||
                            `Something went wrong while we were processing your request. Please try again later! (Error Code: ${e.code})`;
                    }
                }
            }
        );

        if (res) {
            this._verificationToken = res.token;
        }

        const { email, verifying, ...rest } = router.params;
        router.params = rest;

        return res;
    }

    private async _accountDoesntExist(email: string) {
        const signup = await confirm(
            $l("An account with this email address does not exist!"),
            $l("Sign Up"),
            $l("Cancel"),
            {
                icon: "info"
            }
        );
        if (signup) {
            router.go("signup", { email });
        }
    }

    private async _submit(): Promise<void> {
        if (this._loginButton.state === "loading") {
            return;
        }

        if (!this._emailInput.reportValidity()) {
            return;
        }

        this._emailInput.blur();
        this._passwordInput.blur();

        const email = this._emailInput.value;
        let password = this._passwordInput.value;

        if (this._emailInput.invalid) {
            this._errorMessage = $l("Please enter a valid email address!");
            this.rumble();
            this._emailInput.focus();
            return;
        }

        if (!password) {
            this._errorMessage = $l("Please enter your master password!");
            this.rumble();
            this._passwordInput.focus();
            return;
        }

        this._errorMessage = "";
        this._loginButton.start();
        try {
            await app.login(email, password, this._verificationToken);
            this._loginButton.success();
            this.done();
        } catch (e) {
            switch (e.code) {
                case ErrorCode.MFA_REQUIRED:
                    this._loginButton.stop();

                    await app.requestMFACode(email, MFAPurpose.Login);
                    const verify = await this._verifyEmail();

                    if (!verify) {
                        return;
                    }

                    if (!verify.hasAccount) {
                        if (verify.hasLegacyAccount) {
                            this._migrateAccount(email, password, verify.legacyToken!, verify.token);
                        } else {
                            this._accountDoesntExist(email);
                        }
                        return;
                    }

                    return this._submit();
                case ErrorCode.INVALID_CREDENTIALS:
                    this._errorMessage = $l("Wrong username or password. Please try again!");
                    this._loginButton.fail();
                    this.rumble();

                    this._failedCount++;
                    if (this._failedCount > 2) {
                        const recover = await confirm(
                            $l("Can't remember your master password?"),
                            $l("Recover Account"),
                            $l("Try Again")
                        );
                        if (recover) {
                            router.go("recover", { email });
                        }
                    } else {
                        this._passwordInput.focus();
                    }
                    return;
                case ErrorCode.NOT_FOUND:
                    this._loginButton.fail();
                    this._accountDoesntExist(email);
                    return;
                default:
                    this._loginButton.fail();
                    throw e;
            }
        }
    }
}
