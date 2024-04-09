#  GeckoFuzz 

Gecko is a DAO on the Solana network, which uses crowd-sourced computing for  **fast**, **accurate** and **cheap** automated auditing through a decentralised fuzzing infrastructure.


As Solana's first formal verification assisted fuzzer it eliminates manual effort by removing the need for users to write invariants or specify input generation strategies. Users simply provide compiled contracts and Gecko autonomously detects and generates exploits for any vulnerabilities found.

Gecko is a decentralized protocol for automated auditing. It allows anyone to audit any project by contributing computing power. The auditors are rewarded with $FUZL tokens.

[IMG]

# Overview
The importance of auditing has grown significantly in recent years as organisazations strive to ensure the security of their systems, however this has remained a challenging task as many companies struggle to find meaningful vulnearbilities and provide comprehensive and accurate reports. The use of human auditors presents several challenges, including the high costs of recruiting and training qualified personnel and the potential for human error. With the increasing complexity of software systems and the growing volume of data to be analyzed, manual audits can become increasingly time-consuming and error-prone. Likewise automated auditing solutions also present their own set of challenges. They typically require high computational power and incur high running time overhead and many tools sacrifice completeness and soundness of the analysis for faster response time, resulting in both false negative and positive results.

Gecko aims to parallelize novel automated program analysis techniques to gain accurate results in a reasonable amount of time. To achieve high parallelism with low costs, the Gecko Fuzz platform allows the public to contribute computation power to accomplish the automated auditing in return for token rewards. In the meantime, all the program analysis intermediate statistics and waypoints are verified and stored on Solana, which can finally be leveraged to mint the auditing reports.

Unlike traditional collaborative manual auditing platforms Gecko uses sound automated program analysis (e.g., fuzzing and symbolic execution) techniques to provide accurate auditing reports. Since the program analysis results and intermediate waypoints can be easily verified through a fully automated oracle, the manual confirmation process is no longer needed. Gecko can quantify the auditing progress and completeness of auditing reports based on metrics backed with on-chain data.

# Images



# Project Details
### Main Contributions



### Stakeholders
- Project Owners: Anyone who needs an audit for their contract.
- Validator Nodes (Judges): To verify the auditing information (how does this work)?
- Aduditor Nodes: (wardens): Anyone can run a nodes on their computers or even inside browsers to supply computation power for program analysis in return of token rewards.

### Workflow

<img width="1481" alt="4" src="https://github.com/jjjutla/GeckoFuzz/assets/22000925/b47f65d6-3efb-4de2-8af3-19a279c44a5e">


0. Project owner can create an auditing request by staking tokens as bounties and providing the compiled program.
1. The program being audited is divided into smaller subprograms of equal size exploring complexity using static analysis by validator nodes. Each node is assigned a unique subprogram to audit for a specific period. This process, known as partitioning, is extremely fast and helps prevent auditor nodes from wasting computational power on code other nodes have already explored. The partitioning plan is deterministic and can be easily verified by other validator nodes, reaching consensus among all validator nodes before the auditing campaign begins.
2. Each auditor nodes pick up a specific partition in the partitioning plan minted based on weighted sampling. Then, auditor nodes leverage fuzz testing techniques to analyze their subprogram. Auditor nodes are incentivized to prioritize auditing requests that are new, have high program complexity, and offer higher rewards. This is because auditor nodes are motivated to find more test cases that lead to vulnerabilities and new coverage.
3. When auditor nodes detect a test case leading to vulnerability or new code coverage, they mint an NFT for the test case. Judge nodes then verify the test case by re-executing it. Since the execution is deterministic, the outcome must also be deterministic, allowing validator nodes to reach consensus about the validity of test case NFTs.
4. Project owner can terminate an audit request. The termination requests also mint an NFT for an auditing report automatically based on the intermediate statistics, test cases, and vulnerabilities. A reward (i.e., bounties) is then given to the validator nodes and auditor nodes that generated or verified the test case NFTs.



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

# What Invariant it detects

# 🔥 Roadmap
- Allowing project owners to define their own types of vulnerabilities (e.g., business logic violations). 
- Bring in ZK-SNARKs for testcase sharing.
- UI Redesign

### Coming Soon
<img src="https://github.com/jjjutla/GeckoFuzz/assets/22000925/a461800a-4bd6-4e65-896b-b45924ce944f" width="200%">


