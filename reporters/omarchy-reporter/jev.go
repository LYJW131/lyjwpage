package main

// Window-title judgment with TypeSafe's Jev, ported from Mac Telemetry Hub
// (源：LYJW131/MacTelemetryHub Sources/TelemetryCore/JevWindowTitleQuestion.swift
// 与 WindowTitleJudgment.swift). The question texts and the thresholds are a
// pair calibrated together there: change a word and the thresholds need
// measuring again, so the texts stay byte-for-byte the Mac ones.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	jevModel   = "jev-latest"
	jevTimeout = 10 * time.Second
)

// jevEndpoint is a var only so tests can point it at a fake.
var jevEndpoint = "https://api.typesafe.ai/v1/systemone"

const jevPurpose = "The owner is an individual developer whose personal homepage shows a live " +
	"\"what I am using right now\" card. The application name is already published there on " +
	"purpose. The window title below was read from the owner's own Mac and would be published " +
	"next to it, verbatim, visible to anyone on the internet."

type dimension string

const (
	exposesSecret           dimension = "exposesSecret"
	exposesPrivateMatter    dimension = "exposesPrivateMatter"
	exposesConfidentialWork dimension = "exposesConfidentialWork"
	isAdultContent          dimension = "isAdultContent"
	isPoliticallySensitive  dimension = "isPoliticallySensitive"
	isInformative           dimension = "isInformative"
)

// dimensions is the display order; the first five are risks.
var dimensions = []dimension{exposesSecret, exposesPrivateMatter, exposesConfidentialWork, isAdultContent, isPoliticallySensitive, isInformative}

var riskDimensions = dimensions[:5]

func (d dimension) displayName() string {
	return map[dimension]string{
		exposesSecret: "密钥凭据", exposesPrivateMatter: "私人事务", exposesConfidentialWork: "工作机密",
		isAdultContent: "成人内容", isPoliticallySensitive: "政治敏感", isInformative: "信息量",
	}[d]
}

func scopeFence(mine, others string) string {
	return others + " are judged by separate questions asked alongside this one; answer only about " +
		mine + " here. Judge only `state.title` in the context of `state.applicationName`."
}

type noulQuestion struct {
	Type         string            `json:"type"`
	Instructions string            `json:"instructions"`
	Criteria     map[string]string `json:"criteria"`
}

func noul(instructions, yes, no string) noulQuestion {
	return noulQuestion{Type: "noul", Instructions: instructions, Criteria: map[string]string{"true": yes, "false": no}}
}

var jevQuestions = map[dimension]noulQuestion{
	exposesSecret: noul(
		"Decide whether publishing `state.title` verbatim next to `state.applicationName` would "+
			"expose a secret credential: a password, passphrase, API key, access key, client secret, "+
			"token, private key, recovery phrase, one-time code, or an account, card or licence "+
			"number. Answer yes when the title carries such a value, or when it names one specific "+
			"credential record closely enough that the credential itself is identified, such as a "+
			"password-manager entry for a named production key. A file, repository, command or page "+
			"that merely deals with authentication in general — documentation about OAuth, a source "+
			"file named for a login flow, a sign-in page — carries no secret. "+
			scopeFence("credentials", "Private personal matters, employer or client material, adult content and political topics"),
		"The title reveals a credential or pins down one specific credential record: a "+
			"password, passphrase, API or access key, client secret, token, private key, recovery "+
			"phrase or one-time code, an account, card or licence number, or a password-manager "+
			"entry naming a particular production key or account.",
		"No credential is revealed: source files and repositories, a shell prompt, "+
			"documentation about authentication or security, a sign-in or account page with no "+
			"secret in the title, or any title that only mentions keys and passwords as a subject "+
			"without carrying one.",
	),
	exposesPrivateMatter: noul(
		"Decide whether publishing `state.title` verbatim next to `state.applicationName` would "+
			"expose a private matter of the owner's own life or of someone they deal with: money — a "+
			"bank, brokerage, payment, tax or invoice view, a balance, a salary; health or medical "+
			"care; a legal matter or a signed agreement; a romantic or family relationship. Answer "+
			"yes as well when the title names a private individual the owner deals with: a person's "+
			"name in a mail subject, a chat or call with a named person, the subject line of a direct "+
			"message or e-mail. A public figure, an author, an artist, a fictional character, a "+
			"company or a product name is not a private individual. "+
			scopeFence("private personal matters", "Credentials, employer or client material, adult content and political topics"),
		"The title exposes a private personal matter: a bank, brokerage, payment, tax or "+
			"invoice view, a balance or salary figure, a medical, pharmaceutical or mental-health "+
			"topic, a legal case or a contract being signed, a romantic or family matter, or a "+
			"named private individual such as the recipient or subject of a personal e-mail, "+
			"message or call.",
		"Nothing private is exposed: public web pages and documentation, source code, shell "+
			"sessions, public media, published books, films, games and articles, the owner's own "+
			"hobby projects and their notes and plans, and titles naming only public figures, "+
			"authors, companies, products or fictional characters.",
	),
	exposesConfidentialWork: noul(
		"Decide whether publishing `state.title` verbatim next to `state.applicationName` would "+
			"expose material that belongs to an employer or a client rather than to the owner. Answer "+
			"yes only when the title itself shows that ownership: it names an employer, a customer or "+
			"a client company or a named customer account; it carries an internal ticket, incident or "+
			"case key; it marks a document internal, confidential or restricted; it names a company's "+
			"unreleased commercial product or feature; or it states a business figure that is not "+
			"public. The owner is an individual developer working on their own things: their own "+
			"repositories, source files and shell sessions, and their personal notes, plans, agendas "+
			"and drafts about their own life or hobby projects, are not an employer's material, even "+
			"when the project name is unfamiliar — assume an unfamiliar project name is the owner's "+
			"own. The same goes for a terminal or coding-agent session: a task summary, a "+
			"pull-request, branch, commit or feature description, a tool status line such as running, "+
			"thinking, responding or waiting, and words like API, worker, preview, deploy, production "+
			"or a hosting vendor's name describe the owner working on their own project; they are not "+
			"evidence of an employer, a ticket or a roadmap unless the title also names the owner's "+
			"employer, a customer or a ticket key. A public company, product or service that the "+
			"owner's work uses or talks about — a hosting platform, an AI model, an API, a status "+
			"page, a library — is neither an employer nor a customer. "+
			scopeFence("employer or client confidentiality", "Credentials, private personal matters, adult content and political topics"),
		"The title itself shows employer or client ownership: an employer's, customer's or "+
			"client's company name or a named customer account, an internal ticket, incident or "+
			"case key, a document marked internal, confidential or restricted, a company's "+
			"unreleased commercial product or feature, or a business figure that has not been "+
			"published.",
		"The material is the owner's own or already public: their own repositories and source "+
			"files, a shell prompt with a project path, a terminal or coding-agent session showing "+
			"a task, pull request, branch, commit, feature or tool status for the owner's own "+
			"project, a public company, product, platform or service that the work uses or is "+
			"about, their own notes, plans, agendas and drafts, public documentation and web "+
			"pages, public media, or an unfamiliar project name that is most likely one of the "+
			"owner's own.",
	),
	isAdultContent: noul(
		"Decide whether `state.title` is pornographic or sexually explicit. Answer yes when the "+
			"title names an adult site, an explicit video, gallery or story, an NSFW community, board "+
			"or channel, or sex-work advertising, or when it otherwise describes explicit sexual "+
			"content. Answer no for mainstream books, films, television, games, anime and music whose "+
			"titles are not themselves explicit, even when the work carries mature, violent or "+
			"romantic themes, and no for clinical, biological or educational material about sexuality "+
			"and the body. "+
			scopeFence("explicit adult content", "Credentials, private personal matters, employer or client material and political topics"),
		"The title is pornographic or explicitly sexual: an adult video or image site, an "+
			"explicit clip, gallery or story, an NSFW forum, subreddit or channel, or an "+
			"advertisement for sexual services.",
		"The title is not explicit: ordinary sites, files and code; mainstream books, films, "+
			"series, games, anime and music, including works with mature, violent or romantic "+
			"themes; and clinical, biological or educational material about sexuality.",
	),
	isPoliticallySensitive: noul(
		"Decide whether `state.title` touches a political subject that would cause trouble for "+
			"the owner if it appeared on their public personal homepage. Answer yes when the title is "+
			"about a political leader, head of state or party official; a government, party or regime "+
			"and its conduct as a subject of praise, criticism or commentary; a political movement, "+
			"protest, uprising, crackdown or other contested historical or current political event; "+
			"censorship, surveillance, dissidents or human rights; or an ethnic, religious or "+
			"territorial dispute. Answer yes as well when the title points at such a subject through "+
			"a nickname, homophone, abbreviation, code word, meme or fan-culture substitution instead "+
			"of a plain name — political commentary dressed up as entertainment still counts. Answer "+
			"no for neutral coverage of economics, business, technology, science or sport that takes "+
			"no political side and names no contested political subject, and no for the owner's own "+
			"code, files and tools. "+
			scopeFence("political sensitivity", "Credentials, private personal matters, employer or client material and adult content"),
		"The title is about a politically contested subject: a named political leader or "+
			"official, a government, party or regime and its conduct, a political movement, "+
			"protest or suppressed historical event, censorship, surveillance, dissidents or "+
			"human rights, or an ethnic, religious or territorial dispute — including when that "+
			"subject is named indirectly through nicknames, homophones, initials, code words or "+
			"memes.",
		"The title is politically neutral: source code, tools and documentation; ordinary "+
			"technology, science or sport coverage; business and economic reporting that takes no "+
			"political side and names no contested political subject; entertainment with no "+
			"political referent; and everyday personal content.",
	),
	isInformative: noul(
		"Decide whether `state.title` tells a visitor anything beyond `state.applicationName` "+
			"itself — what is being read, edited, watched, played or worked on, such as a file, a "+
			"page, a repository, a document, a conversation partner or a track. Answer yes when the "+
			"title names such content, even briefly. Answer no when the title is only the "+
			"application's own name or a close variant of it, or generic window chrome that any user "+
			"of that application would see, such as \"Untitled\", \"无标题\", \"主窗口\", \"New Tab\", "+
			"\"Preferences\", \"Settings\", \"Window\" or an empty name. Judge only how much the title adds "+
			"to the application name; whether the content is sensitive is judged by separate "+
			"questions asked alongside this one.",
		"The title names specific content or context worth showing next to the application "+
			"name: a file or document name, a web page or site, a repository or project, a media "+
			"title, a conversation, a shell path.",
		"The title adds nothing: it repeats or paraphrases the application name, or it is "+
			"generic chrome such as an untitled or new document, a preferences or settings "+
			"window, a bare window label, or an empty string.",
	),
}

type jevState struct {
	Purpose          string  `json:"purpose"`
	ApplicationName  string  `json:"applicationName"`
	BundleIdentifier *string `json:"bundleIdentifier"`
	Title            string  `json:"title"`
}

type jevRequest struct {
	Model     string                     `json:"model"`
	State     jevState                   `json:"state"`
	Questions map[dimension]noulQuestion `json:"questions"`
}

// newJevRequest asks all six questions at once. The Wayland app_id goes
// where the Mac sends the bundle ID: the same role, one stable app identity.
func newJevRequest(applicationName, appID, title string) jevRequest {
	return jevRequest{
		Model:     jevModel,
		State:     jevState{Purpose: jevPurpose, ApplicationName: applicationName, BundleIdentifier: optional(appID), Title: title},
		Questions: jevQuestions,
	}
}

type verdict string

const (
	verdictPublished         verdict = "published"
	verdictLocked            verdict = "locked"
	verdictNeedsConfirmation verdict = "needsConfirmation"
	verdictOmitted           verdict = "omitted"
)

func (v verdict) displayName() string {
	return map[verdict]string{
		verdictPublished: "已公开", verdictLocked: "已锁定", verdictNeedsConfirmation: "待确认", verdictOmitted: "已省略",
	}[v]
}

func (v verdict) reviewOrder() int {
	return map[verdict]int{verdictLocked: 0, verdictNeedsConfirmation: 1, verdictOmitted: 2, verdictPublished: 3}[v]
}

// thresholds turn the six probabilities into a verdict: any risk at or above
// lock locks; then too little information omits; all risks at or below clear
// publish; anything in between waits for the owner.
type thresholds struct{ riskLock, riskClear, informative float64 }

var standardThresholds = thresholds{riskLock: 0.6, riskClear: 0.10, informative: 0.5}

func (t thresholds) judge(p map[dimension]float64) (verdict, []dimension) {
	var locking []dimension
	for _, d := range riskDimensions {
		if risk(p, d) >= t.riskLock {
			locking = append(locking, d)
		}
	}
	if len(locking) > 0 {
		return verdictLocked, locking
	}
	if p[isInformative] < t.informative {
		return verdictOmitted, nil
	}
	if len(t.unsettled(p)) == 0 {
		return verdictPublished, nil
	}
	return verdictNeedsConfirmation, nil
}

func (t thresholds) unsettled(p map[dimension]float64) []dimension {
	var out []dimension
	for _, d := range riskDimensions {
		if v := risk(p, d); v > t.riskClear && v < t.riskLock {
			out = append(out, d)
		}
	}
	return out
}

// risk reads a missing answer as the worst case.
func risk(p map[dimension]float64, d dimension) float64 {
	if v, ok := p[d]; ok {
		return v
	}
	return 1
}

type jevError struct {
	status int
	detail string
}

func (e *jevError) Error() string {
	if e.detail != "" {
		return fmt.Sprintf("TypeSafe 返回 HTTP %d：%s", e.status, e.detail)
	}
	return fmt.Sprintf("TypeSafe 返回 HTTP %d", e.status)
}

// retryable: 429 is the rate limit, 529 and other 5xx are overload; a bad
// key or a malformed question fails the same way however often it is sent.
func (e *jevError) retryable() bool { return e.status == 429 || e.status >= 500 }

var errMissingAnswer = fmt.Errorf("TypeSafe 响应里缺了某道题的答案")

func askJev(ctx context.Context, client *http.Client, apiKey, applicationName, appID, title string) (map[dimension]float64, error) {
	body, err := json.Marshal(newJevRequest(applicationName, appID, title))
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, jevTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, jevEndpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	req.Header.Set("Content-Type", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 256*1024))
	if res.StatusCode/100 != 2 {
		return nil, &jevError{status: res.StatusCode, detail: errorDetail(raw)}
	}
	return parseJevAnswers(raw)
}

// parseJevAnswers fails when any of the six answers is missing: they come
// from one call, and a missing political answer must not read as clean.
func parseJevAnswers(raw []byte) (map[dimension]float64, error) {
	var decoded struct {
		Answers map[string]struct {
			Noul *float64 `json:"noul"`
		} `json:"answers"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil, err
	}
	p := map[dimension]float64{}
	for _, d := range dimensions {
		a, ok := decoded.Answers[string(d)]
		if !ok || a.Noul == nil {
			return nil, errMissingAnswer
		}
		p[d] = *a.Noul
	}
	return p, nil
}

func errorDetail(raw []byte) string {
	var obj map[string]any
	if json.Unmarshal(raw, &obj) == nil {
		for _, f := range []string{"error", "detail", "message"} {
			if s, ok := obj[f].(string); ok && s != "" {
				return s
			}
		}
	}
	return strings.TrimSpace(string(raw))
}

func formatProb(v float64) string { return fmt.Sprintf("%.2f", v) }
