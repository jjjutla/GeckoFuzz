#  GeckoFuzz 

Gecko is a DAO on the Solana network, which uses crowd-sourced computing for  **fast**, **accurate** and **cheap** automated auditing through a decentralised fuzzing infrastructure.

<p align="center">
  <img src="https://github.com/jjjutla/GeckoFuzz/assets/22000925/0a7b965d-8c04-41ea-8065-40d431270dc0" width="26%" height="26%">
</p>

It enables anyone to audit projects by contributing computing power and rewards contributors with $FUZL tokens. Gecko is the first formal verification-assisted fuzzer for Solana, capable of automatically detecting and exploiting vulnerabilities in on-chain contracts.

As **Solana's first formal verification assisted fuzzer** it eliminates manual effort by removing the need for users to write invariants or specify input generation strategies. Users simply provide compiled contracts and Gecko autonomously detects and generates exploits for any vulnerabilities found.

# Overview
The importance of auditing has grown significantly however we don’t have a solution to combat cyberattacks at the speed and scale necessary. Human auditors face issues like high costs, potential for errors and slow processing, which becomes less practical as systems grow more complex. And automated solutions often demand significant computational resources and can compromise thoroughness for speed.

Gecko aims to parallelize novel automated program analysis techniques to gain accurate results in a reasonable amount of time. To achieve high parallelism with low costs, the Gecko Fuzz platform allows the public to contribute computation power to accomplish the automated auditing in return for token rewards. In the meantime, all the program analysis intermediate statistics and waypoints are verified and stored on Solana, which can finally be leveraged to mint the auditing reports.

Unlike traditional collaborative manual auditing platforms Gecko uses sound automated program analysis (e.g., fuzzing and symbolic execution) techniques to provide accurate auditing reports. Since the program analysis results and intermediate waypoints can be easily verified through a fully automated oracle, the manual confirmation process is no longer needed. Gecko can quantify the auditing progress and completeness of auditing reports based on metrics backed with on-chain data.

- **3-min Demo & Pitch:** https://youtu.be/G0KEAc0JpWA
- **Twitter:** https://twitter.com/GeckoFuzzer

# Images

<img width="49%" alt="1" src="https://github.com/jjjutla/GeckoFuzz/assets/22000925/5690840b-4d10-4fda-a276-3392fa2d6e66">
<img width="49%" alt="2" src="https://github.com/jjjutla/GeckoFuzz/assets/22000925/fc06f7b6-348b-4457-9174-3a752a992808">
<img width="49%" alt="3" src="https://github.com/jjjutla/GeckoFuzz/assets/22000925/bb4b64c7-4e9b-4153-b0cc-314c93a83498">
<img width="49%" alt="5" src="https://github.com/jjjutla/GeckoFuzz/assets/22000925/f6e0edcf-ecdb-45cf-9457-f62faae1a01b">
<img width="49%" alt="6" src="https://github.com/jjjutla/GeckoFuzz/assets/22000925/57c53324-96c1-4bea-8856-36730f037490">
<img width="49%" alt="7" src="https://github.com/jjjutla/GeckoFuzz/assets/22000925/ce137338-bd63-4c91-80b2-9aa0c870afa1">
<img width="49%" alt="8" src="https://github.com/jjjutla/GeckoFuzz/assets/22000925/6dcbe2a9-e4c5-432f-bd93-b629470d8e3f">
<img width="49%" alt="9" src="https://github.com/jjjutla/GeckoFuzz/assets/22000925/3117729d-2069-425b-9f75-c901928bbf5c">

# Project Details
### Main Contributions
- Solana’s first formal verification assisted fuzzer
- On-chain testing & multi contract analysis
- Can leverage crowd-sourced computation for fast and cheap fuzzing


### Stakeholders
- Project Owners: Anyone who needs an audit for their contract.
- Validator Nodes (Judges): To verify the auditing information
- Aduditor Nodes: (wardens): Anyone can run a nodes on their computers or even inside browsers to supply computation power for program analysis in return of token rewards.

### Workflow

![4](https://github.com/jjjutla/GeckoFuzz/assets/22000925/cabbdf7f-2620-4389-b1bc-a298c2a9d248)

0. Project owners can start audits by staking tokens and submitting their compiled program. 
1. Validator nodes use static analysis to break the program into smaller, equally complex subprograms for auditing.
2. Auditor nodes are incentivized by rewards and select partitions using weighted sampling and employ fuzz testing to identify vulnerabilities or new coverage.
3. Detected vulnerabilities or new coverage are then minted as NFTs by auditor nodes and verified by judge nodes through deterministic re-execution.
4. Project owners can end audits, triggering an NFT to mint as an audit report that incorporates findings and rewards validators and auditors for their contributions.


# Technical Details
### Partitioning Plan Synthesis
By converting a program into LLVM bytecode, we can create a weighted control flow graph (CFG) of it with the weight of each edge as relative difficulty of exploring such an edge. Graph partitioning algorithms can then partition the CFG into sub-trees, with the starting node of the CFG as the root of each tree. The partition plan can be concisely represented in O(log n) bytes, where `n` is the size of the CFG, making it possible to be fit into an on-chain variable.

To determine the difficulty of exploring each edge in the CFG, we utilize static analysis tools. We pinpoint the comparison instruction that leads to the edge and determine the domain size of both the LHS and RHS. The domain size represents the likelihood of program execution failing into either side if the input is randomly selected. Currently, we use heuristics to determine the domain size. As future work, we can use abstract interpretation algorithms with a constraint solver to calculate it. The exploration difficulty is then estimated by dividing the domain size of the LHS and RHS.

For instance, consider following simple program:

``` rust
// input: Vec<u8>
if (input[0] > 20) { // Line 1
    bug(); // Line 2
} // Line 3
```

The CFG would be:

```
              ┌──────────────┐
       ┌──────┤    Line 1    │
       │      └───────┬──────┘
       │ E2           │ E1
       │      ┌───────▼──────┐
       │   ┌──┤    Line 2    |
       │   │  └──────────────┘          
       │   │ E3              
┌──────▼───▼───┐ 
│    Line 3    |
└──────────────┘
```

Given `u8` domain is 256, weight (exploration difficulty) of E1 is `(256 - 20) / (256 + 20)` and `E2` is `(256 + 20) / (256 - 20)`. By intuition, E2 is indeed more likely to be explored than E1. As there is no comparison instruction in during transition of E3, the exploration difficulty is 0, meaning as long as we can reach Line 2, we can reach Line 3.

### Dynamic Program Analysis (DPA)
Gecko compiles the Solana contract into LLVM bytecode and leverages fuzz testing techniques, which involve sending random input to the program. This method, also known as heuristic search, aims to achieve 100% code coverage and uncover all vulnerabilities. While infinite time would guarantee zero false negatives, we use formal methods such as symbolic and concolic execution for guiding the fuzz testing search to reduce the time needed. Additionally, by partitioning the program into smaller, more manageable subprograms for each node, we can reduce the time required linearly as the number of nodes increases.

Fuzz testing employs partitioning through the use of an instrumented target. If an input causes execution of code outside the partition plan, the target will terminate. Early termination reduces the time spent exploring code not within the partition, saving significant time. Similarly, symbolic and concolic execution can also conduct early-termination to avoid exploring code outside the partition.

### Reaching Consensus
Verifying partition plans and interesting test cases can be costly or even impossible on the chain. Thus, validator nodes use off-chain oracles. Gecko uses rollup techniques to move the oracle results onto the chain and reach consensus. Specifically, an optimistic rollup pallet is implemented to achieve consensus on partition plans and interesting test cases. Once a validator node mints a partition plan or an auditor node mints a test case NFT, other validator nodes can submit fraud proofs to challenge it within 50 blocks, or it will be committed. Unlike human auditors or judges, validator nodes can find evidence to challenge false claims in microseconds, as the verification process is automated and inexpensive, making optimistic rollups effective.

**Interactively Partition Plan Verification:** Claimer can create a partition plan by submitting the weighted CFG and list of nodes in the CFG that needs to be divided. A challenger can either challenge the weighted CFG or the partition plan. To challenge the weighted CFG, the challenger submits a fraud-proof consisting of the root node of the minimum differing subtree in the CFG. The chain partially re-generates from that root node to the first child node by looking at branch, jump, and call instructions. That node must equal either party's differing node if at least one party is honest. Although generating full CFG is a costly operation as multiple complex graph analysis algorithm is needed, generating the next node with a known subgraph and context is cheap. To challenge the partition plan, the challenger must submit a better plan. The chain can compare the balance of each subgraph's total weights and determine which is the best partition plan. Comparison is very cheap since the chain only needs to sum up the weight of each subgraph and divide them.

**Interactively Testcase Verification:** Claimer can confirm a test case by submitting the execution trace (a trace of basic blocks hit during execution) of the test case to the chain. The initial fraud-proof consists of the first differing program counter (PC) in execution trace and the state (i.e., dirty page of the memory and stack) before the differing PC. The challenged claimer can dispute the state and find the first differing state interactively with the challenger. When either the differing PC or state is found, the chain will re-execute partially from the state and PC with consensus (i.e., state and PC before the differing ones) using LLVM bytecode virtual machine. Since the execution would lead to a concrete result that is directly equal to that of either challenger or claimer, the chain can decide which party is gaming. Partial re-execution is not costly since the chain only needs to execute the basic block with dispute, which is usually a few simple instructions. A potential future work would be replacing this process with zero-knowledge proof.

# What Invariants it detects
- **Balance Extraction**: Detect whether the attacks can steal SOL from the contracts
- **Token Extraction**: Detect whether the attackers can steal SPL tokens from the contracts
- **Chainlink Issues**: Identify misuse of Chainlink that could lead to a range of attacks
- **Arbitary Selfdestruct**: Detect whether the attackers can make contract self-destruct.


# Testing


### Staging Environment:

```
stats-backend: https://stats-api-stg.geckofuzz.com
telemetry-backend: https://telemetry-grpc-gw-stg.geckofuzz.com
ipfs-gateway: https://ipfs.geckofuzz.com
frontend: https://stg.geckofuzz.com

```

### Deploy Backend & Frontend
```
gcloud container clusters get-credentials gecko-1 --region us-central1-a
# use AMD machine to build, otherwise it breaks k8s on gcp
./build_images.sh
kubectl get deployment
```

### Ingress
```
kubectl expose deployment [NAME] --port=[SRC_PORT] --target-port=[DST_PORT]
vim deploy/nginx-ingress/ingress.yaml
kubectl apply -f deploy/nginx-ingress/ingress.yaml
```

# 🔥 Roadmap
- Allowing project owners to define their own types of vulnerabilities (e.g., business logic violations). 
- Bring in ZK-SNARKs for testcase sharing.
- UI Redesign

### Coming Soon

<p align="center">
  <img src="https://github.com/jjjutla/GeckoFuzz/assets/22000925/a461800a-4bd6-4e65-896b-b45924ce944f" width="200%" >
</p>



