---
title: "🧮 The Maths behind Bayes’ Theorem and The Resurrection"
date: "2025-02-22"
wpSlug: "maths"
lang: "en"
pairedSlug: "수학"
featuredImage: "/assets/SCR-20250222-vpr.jpeg"

tags: ["theology"]
---

(This is an addendum to the [main essay found here](/bayes). 다시 원 에세이로 가려면 [여기](/%eb%b2%a0%ec%9d%b4%ec%a6%88).)

Let’s walk through the main calculation, adding a few details to account for _**N**_ independent eyewitnesses. Even if you’re not mathematically inclined, I believe this exercise will help you appreciate key aspects of the process we use every day: how we constantly update our prior beliefs in light of new evidence, the exponentially powerful impact of multiple independent witnesses, and the importance of keeping an open mind—namely, not setting prior probabilities to zero. As long as the prior probability, no matter how small, is greater than zero, the overwhelming weight of independent, credible testimonies will easily shift the belief towards a more evidence-driven conclusion, regardless of how improbable the event seemed at first. This is the power of Bayesian reasoning—showing that evidence can truly reshape our understanding, even when starting from a low prior. 

## Formulation of Bayes’ Theorem

First, let’s define some terms:

-   **P(M)** represents the prior probability (or, if you prefer, your initial belief or presupposition) that a miracle **M** happened. In this case, we’re talking about the resurrection of Jesus on the third day.
-   **P(M|O)** is the posterior probability, or the updated belief about the miracle **M**, given the evidence **O** (such as eyewitness testimonies).
-   **P(O)** is the overall probability of the evidence **O** occurring. This is a crucial factor because it helps properly normalise the overall probability and bring us to the posterior probability.
-   **P(O|M)** is a more challenging concept, but it is essential to understanding Bayes’ Theorem. It refers to the likelihood of the evidence (the eyewitness testimonies) **_assuming_** that the resurrection actually happened. This is how probable the testimonies are, given that the event occurred.

Baye’s Theorem itself states that:

> The **posterior probability** of Jesus’ resurrection, given the eyewitness testimonies, is equal to the (appropriately normalised) **probability** of those testimonies being true assuming the resurrection happened, multiplied by the **prior probability** that a supernatural event like the resurrection could occur.

This is written mathematically as:

![ql_a0f40b7601f734a4c6bf1de10e54ddc8_l3.png](/assets/image.png)

Now, we can express the denominator as:

![ql_dcf17c899a6750635f66363fadb5286e_l3.png](/assets/image-1.png)

With some rearranging, we can simplify the expression for the posterior probability to:

![ql_11ecdf07ab36e8fb40f2877c0e9b4b83_l3.png](/assets/image-2.png)

At this point, the formula may look a bit complicated, but don’t worry—it boils down to two key ratios:

1.  The ratio of **prior probabilities**: the probability of the resurrection being real versus not real.
2.  The ratio of **likelihoods of the evidence**: how likely the eyewitness testimonies are, assuming the resurrection happened versus assuming it didn’t.

Let’s focus on the first ratio. The key point here is **the importance of keeping an open mind**. This means we don’t assume a prior probability of zero for miracles, no matter how unlikely they might seem. In mathematical terms:

![ql_c377b2f737448cb57bcb1ece6b5b7c2f_l3.png](/assets/image-3.png)

In simpler terms, this means we assign a non-zero probability to the resurrection being possible.

It’s worth briefly noting that, in light of the advancements in **quantum mechanics** over the last century, this non-zero prior probability isn’t just reasonable—it’s actually in keeping with the current understanding of the universe. Quantum theory teaches that nothing is strictly “impossible”—only “improbable.” By this logic, to dismiss miracles outright by setting their prior probability to zero contradicts the very principles of modern science, where probabilities govern all phenomena, even those that might seem extraordinary.

## Multiple Independent Eyewitnesses

Now let’s focus on the second ratio. **How can we incorporate the testimonies of _N_ independent eyewitnesses into our calculation?**

To do this, we need to apply a key rule of probability, known as the **multiplication rule for independent events**. This rule states:

![ql_69f4811311e2bfaf932b0e5235464cbc_l3.png](/assets/image-4.png)

In simple terms, it says that the probability of two independent events—A and B—both occurring is the product of their individual probabilities.

Now, let’s extend this concept to **_N_** independent eyewitnesses. The probability of all **_N_** eyewitnesses independently corroborating the miracle (i.e., witnessing the resurrection) is the product of the probabilities of each individual testimony. Mathematically, we write this as:

![ql_a56e51d9f8ec8da6a124e42cbb097dde_l3.png](/assets/image-5.png)

This equation shows how we multiply the probabilities of each eyewitness testimony to find the overall likelihood of the evidence, assuming the resurrection occurred.

With this, we can now re-write the ratio of likelihoods from earlier:

![ql_76f6b79803d4f874ca0fe1feff740042_l3.png](/assets/image-6.png)

Here, **_t_** represents the **average trustworthiness** of an independent eyewitness. In this context, **trustworthiness** is defined as the ratio of two probabilities: the probability that an eyewitness would report having seen the resurrection, assuming the resurrection actually occurred, versus the probability that an eyewitness is falsely claiming to have seen it, assuming the resurrection did not happen.

For the average person, who is not a sociopath or psychopath, we can reasonably expect this **_t_** value to be greater than 1. This reflects the idea that most people are generally truthful and would not invent such a testimony unless they had genuinely experienced it.

Putting it together, the expression for our posterior probability now reads:

![ql_f65d697ead796bc4a5a883498ede7cbf_l3.png](/assets/image-10.png)

Let’s now follow in the footsteps of Charles Babbage, the father of computing, and calculate some key probabilities involved in evaluating the evidence for the resurrection. We’ll use numerical approximations to estimate the likelihood of Jesus’ resurrection based on the principles of Bayes’ Theorem. To do this, we need to make educated guesses about three main factors:

-   **_t_** = 2. This represents the “trustworthiness” of an individual eyewitness, on a scale where 1 would mean total uncertainty (essentially no trust) and anything above 1 indicates reliability. Here, we’ll use **2** as a very conservative estimate, meaning we are assuming each eyewitness is, on average, twice as likely to be truthful than not. This is a modest estimate—given the nature of the event and the character of the people involved, this number could easily be higher.
-   **_N_** \= 500. The number of independent eyewitnesses. We base this on the scriptural record, particularly **1 Corinthians 15:6**, which states that more than **500 people** saw Jesus alive after His resurrection. This isn’t just a handful of witnesses, but a large group of people, all at the same time, all reporting the same event. A side note: the idea of **mass hallucinations** occurring in such a large group at once is not only highly implausible but, as far as we know, has never been documented in human history.
-   _**ε**_ = 10\-100. This is the **prior probabilit**y, which serves as our starting point for the calculation. It represents how likely we initially believe a supernatural event, like the resurrection, is to occur. 10\-100 is an unimaginably small number—far smaller than anything we would encounter in everyday life. To put it in perspective, this is the probability of randomly selecting the exact atom in a whole galaxy cluster. Yet, it’s still not zero. The key point here is that even though this prior probability is astronomically small, it’s not so small that we rule out the possibility completely. As long as it’s not zero, the additional evidence (such as eyewitness testimony) can still have an impact on our final conclusion.

In fact, it’s worth briefly noting that, in light of recent advancements in quantum mechanics, this non-zero prior is not only reasonable, but also aligns with modern scientific thinking. Quantum theory has taught us that nothing is strictly “impossible”—only “improbable.” Events that seem extraordinarily unlikely can still happen, and probabilities govern all phenomena, even those that defy our intuitions. This stands in stark contrast to what David Hume did in his essay _On Miracles_, where he effectively set the prior probability for miracles to zero, dismissing them outright as impossible. Hume’s approach, in which he arrogantly closed the door on any possibility of the supernatural, reflects a profound ignorance of the very nature of probability and scientific inquiry. By setting the prior to zero, he not only ignored the potential for new evidence to shape our beliefs but also contradicted the principles of modern science itself. In contrast, by leaving the prior non-zero, we allow room for the evidence—like credible eyewitness testimony—to update our beliefs in a way that aligns with both reason and scientific understanding.

Now, let’s do the math. First, we calculate the contribution of the eyewitnesses using the formula _**tN**_ :

![ql_a47f016c86713c4143ceb26848e654f2_l3.png](/assets/image-8.png)

The impact of independent testimonies grows exponentially—10 to the power of 167—illustrating how their combined strength amplifies in an overwhelmingly powerful way.

Now, using Bayes’ Theorem, we can calculate the **posterior probability**, which tells us how likely the resurrection is, given the evidence. This is written as:

![ql_c15bdc3383e5ddb6d87cc6b534b46a80_l3.png](/assets/image-9.png)

This approximation shows that the posterior probability of the resurrection is virtually **100%**, or **99.99999…** with **65 nines** after the decimal! In other words, once we update our prior belief with the overwhelming evidence of **500 independent eyewitnesses** who all testified to seeing the risen Jesus, the probability that the resurrection actually happened skyrockets.

Having gone through an entire Bayesian calculation process from the beginning to the end, I hope now that you will better appreciate key aspects of the process we use everyday: how we constantly update our prior beliefs in light of new evidence, the **exponentially powerful impact of multiple independent witnesses**, and the **importance of keeping an open mind**—namely, not setting prior probabilities to zero. As long as the prior probability, no matter how small, is greater than zero, the overwhelming weight of independent, credible testimonies will easily shift the belief towards a more evidence-driven conclusion, regardless of how improbable the event seemed at first. This is the power of Bayesian reasoning—showing that evidence can truly reshape our understanding, even when starting from a low prior.

(Click [here](/bayes) to go back to the main essay.)  
