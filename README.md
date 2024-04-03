# Gecko Fuzz

# Introduction
Gecko is a DAO leveraging crowd-sourced computation power to achieve **fast**, **accurate** and **cheap** auomated auditing on the Solana network, through a decentralised fuzzing infrastructure. 

The importance of auditing has grown significantly in recent years as organizations strive to ensure the integrity and security of their systems. However, despite the importance of auditing, it remains challenging, with many auditing companies struggling to provide comprehensive and accurate reports.

The use of human auditors by auditing firms presents several challenges, including the high costs of recruiting and training qualified personnel and the potential for human error. With the increasing complexity of software systems and the growing volume of data to be analyzed, manual audits can become increasingly time-consuming and error-prone. On the other hand, automated auditing solutions also present their own set of challenges. These solutions typically require high computational power and incur high running time overhead. Thus, many traditional automated auditing tools sacrifice completeness and soundness of the analysis for faster response time, resulting in both false negative and positive results.

In contrast, Gecko aims to parallelize novel automated program analysis techniques to gain accurate results in a reasonable amount of time. To achieve high parallelism with low costs, the Gecko Fuzz platform allows the public to contribute computation power to accomplish the automated auditing in return for token rewards. In the meantime, all the program analysis intermediate statistics and waypoints are verified and stored on Solana, which can finally be leveraged to mint the auditing reports.

Unlike traditional collaborative manual auditing platforms Gecko uses sound automated program analysis (e.g., fuzzing and symbolic execution) techniques to provide accurate auditing reports. Since the program analysis results and intermediate waypoints can be easily verified through a fully automated oracle, the manual confirmation process is no longer needed. While it is impossible to quantify the performance of human auditors, Gecko can quantify the auditing progress and completeness of auditing reports based on metrics backed with on-chain data.

The Gecko platform can offer two key benefits to the ecosystem. Firstly, it allows Solana developers to to access low-cost, highly accurate auditing reports for their projects with on-chain guarantees. Secondly ...


# Technical Details
### Partitioning Plan Synthesis
By converting a program into LLVM bytecode, we can create a weighted control flow graph (CFG) of it with the weight of each edge as relative difficulty of exploring such an edge. Graph partitioning algorithms can then partition the CFG into sub-trees, with the starting node of the CFG as the root of each tree. The partition plan can be concisely represented in O(log n) bytes, where `n` is the size of the CFG, making it possible to be fit into an on-chain variable.

To determine the difficulty of exploring each edge in the CFG, we utilize static analysis tools. We pinpoint the comparison instruction that leads to the edge and determine the domain size of both the LHS and RHS. The domain size represents the likelihood of program execution failing into either side if the input is randomly selected. Currently, we use heuristics to determine the domain size. As future work, we can use abstract interpretation algorithms with a constraint solver to calculate it. The exploration difficulty is then estimated by dividing the domain size of the LHS and RHS.

For instance, consider following simple program:

''' rust
// input: Vec<u8>
if (input[0] > 20) { // Line 1
    bug(); // Line 2
} // Line 3
'''


